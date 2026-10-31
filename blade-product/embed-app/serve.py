#!/usr/bin/env python3
"""Serve embed-app and reverse-proxy its API prefixes to local Blade ports.

Access tickets are renewed on this host. /embed-auth and the local Blade
proxy check the exp of EMBED_TOKEN. When less than an hour remains, or Blade
Agent / Blade Hub returns 401 for that server ticket, the service exchanges
EMBED_REFRESH_TOKEN at local Blade Agent POST /api/auth/refresh. That call
rotates the refresh ticket, so the new access ticket and the new refresh
ticket are written back to the proxy env file before another refresh can
start. A missing refresh ticket does not drop a configured access ticket;
the reason is logged.

If the caller sends Authorization: Bearer, /api-ba, /api-bh, /api-bos,
/api-llm and /api/catalog-counts forward that ticket and do not replace it
with EMBED_TOKEN. Requests without a caller ticket still use EMBED_TOKEN.
Batch delete never falls back to EMBED_TOKEN.
"""

import base64
import json
import os
import posixpath
import re
import sys
import tempfile
import threading
import time
from urllib.parse import quote, unquote, urlsplit

import http.client

try:
    import fcntl
except ImportError:
    fcntl = None

try:
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
except ImportError:
    from http.server import HTTPServer, SimpleHTTPRequestHandler
    from socketserver import ThreadingMixIn

    class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
        daemon_threads = True

ROOT = os.environ.get("EMBED_ROOT", "/opt/embed-app/dist")
PORT = int(os.environ.get("EMBED_PORT", "5174"))
FRAME_ANCESTORS = os.environ.get("EMBED_FRAME_ANCESTORS", "*").strip() or "*"
CSP = "frame-ancestors " + FRAME_ANCESTORS

# 反代只访问本机 Blade。浏览器里的 8020/8010 地址来自 blade-site.js，不使用 127.0.0.1。
PROXIES = (
    ("/api-ba", "127.0.0.1", 8020),
    ("/api-llm", "127.0.0.1", 30000),
    ("/api-bh", "127.0.0.1", 8010),
    ("/api-bos", "127.0.0.1", 80),
)

# blade-auth-client 默认 cookie，与 iframe 插件 autologin.html 一致。
# POST /api/auth/refresh 只读刷新票，成功时 Set-Cookie 同时下发新的两张票。
ACCESS_COOKIE = "blade_token"
REFRESH_COOKIE = "blade_refresh_token"
REFRESH_PATH = "/api/auth/refresh"
# 距过期不足 1 小时就续期，已过期同样续期。上游 401 不等到这一小时。
REFRESH_WITHIN_SECONDS = 3600
# 刚换过票仍被拒绝时，不要每个请求都轮换一次一次性刷新票。
REFRESH_COOLDOWN_SECONDS = 60
# 只有这两端口的 401 表示访问票被 Blade 拒绝。其它反代的 401 不换票。
BLADE_AUTH_PORTS = (8020, 8010)

_refresh_lock = threading.Lock()
# 换票已经成功但写回失败时留在内存里。下次只重试写回，不再用旧刷新票轮换一次。
_pending = None
_last_attempt_at = 0.0
_last_failure = ""
_logged = set()


class TokenError(Exception):
    pass


def log_token(message):
    sys.stderr.write("embed-app token: %s\n" % message)
    sys.stderr.flush()


def log_token_once(key, message):
    if key in _logged:
        return
    _logged.add(key)
    log_token(message)


def clear_token_log(*keys):
    for key in keys:
        _logged.discard(key)


class EnvLock(object):
    """跨进程互斥。刷新票一次性使用，两个进程不能同时拿同一张去轮换。"""

    def __init__(self, path):
        self.path = path + ".lock"
        self.fd = None

    def __enter__(self):
        directory = os.path.dirname(os.path.abspath(self.path)) or "."
        if not os.path.isdir(directory):
            return self
        self.fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        if fcntl is not None:
            fcntl.flock(self.fd, fcntl.LOCK_EX)
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.fd is None:
            return False
        try:
            if fcntl is not None:
                fcntl.flock(self.fd, fcntl.LOCK_UN)
        finally:
            os.close(self.fd)
            self.fd = None
        return False


def token_path():
    return os.environ.get("EMBED_PROXY_ENV", "/opt/embed-app/proxy.env")


def refresh_target():
    for prefix, host, port in PROXIES:
        if prefix == "/api-ba":
            return host, port
    return "127.0.0.1", 8020


def read_env(path):
    values = {}
    if not os.path.isfile(path):
        return values
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            raw = line.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            key, value = raw.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def configured_tokens(path):
    try:
        values = read_env(path)
    except (OSError, UnicodeError):
        raise TokenError("无法读取凭据文件")
    return values.get("EMBED_TOKEN", ""), values.get("EMBED_REFRESH_TOKEN", "")


def load_token(path):
    return configured_tokens(path)[0]


def acceptable_secret(value):
    if not value:
        return False
    for char in value:
        if char <= " " or char in ";,":
            return False
    return True


def access_exp(token):
    parts = token.split(".")
    if len(parts) != 3 or not parts[1]:
        return None
    payload = parts[1]
    payload += "=" * ((4 - len(payload) % 4) % 4)
    try:
        data = json.loads(base64.urlsafe_b64decode(payload.encode("ascii")))
    except (ValueError, TypeError, UnicodeError):
        return None
    if not isinstance(data, dict):
        return None
    exp = data.get("exp")
    if isinstance(exp, bool) or not isinstance(exp, (int, float)):
        return None
    return float(exp)


def needs_refresh(token, now=None):
    exp = access_exp(token)
    if exp is None:
        return False
    if now is None:
        now = time.time()
    return exp - now < REFRESH_WITHIN_SECONDS


def access_expired(token, now=None):
    exp = access_exp(token)
    if exp is None:
        return False
    if now is None:
        now = time.time()
    return exp <= now


def upsert_line(lines, key, value):
    found = False
    output = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            name = stripped.split("=", 1)[0].strip()
            if name == key:
                if not found:
                    output.append("%s=%s" % (key, value))
                    found = True
                continue
        output.append(line)
    if not found:
        output.append("%s=%s" % (key, value))
    return output


def write_tokens(path, access, refresh):
    mode = 0o600
    original = ""
    if os.path.isfile(path):
        mode = os.stat(path).st_mode & 0o777
        with open(path, encoding="utf-8") as handle:
            original = handle.read()
    lines = upsert_line(original.splitlines(), "EMBED_TOKEN", access)
    lines = upsert_line(lines, "EMBED_REFRESH_TOKEN", refresh)
    text = "\n".join(lines)
    if not text.endswith("\n"):
        text += "\n"
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp = tempfile.mkstemp(prefix=".proxy.env.", dir=directory)
    try:
        os.write(fd, text.encode("utf-8"))
        os.fsync(fd)
        os.close(fd)
        fd = None
        os.chmod(tmp, mode)
        os.replace(tmp, path)
        tmp = None
    finally:
        if fd is not None:
            os.close(fd)
        if tmp is not None:
            try:
                os.remove(tmp)
            except OSError:
                pass


def parse_set_cookies(resp):
    headers = getattr(resp, "headers", None)
    chunks = []
    if headers is not None and hasattr(headers, "get_all"):
        chunks.extend(headers.get_all("Set-Cookie") or [])
    text = "\n".join(chunks)
    found = {}
    for name in (ACCESS_COOKIE, REFRESH_COOKIE):
        value = cookie_value(text, name)
        if value:
            found[name] = value
    return found


def cookie_value(text, name):
    marker = name + "="
    start = 0
    while True:
        index = text.find(marker, start)
        if index < 0:
            return ""
        if index > 0 and text[index - 1] not in "\n;, ":
            start = index + len(marker)
            continue
        raw = text[index + len(marker):].split(";", 1)[0].split("\n", 1)[0].strip()
        if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
            raw = raw[1:-1]
        return raw


def exchange_refresh(refresh_token):
    host, port = refresh_target()
    conn = http.client.HTTPConnection(host, port, timeout=20)
    try:
        try:
            conn.request(
                "POST",
                REFRESH_PATH,
                body=b"",
                headers={
                    "Cookie": "%s=%s" % (REFRESH_COOKIE, refresh_token),
                    "Accept": "application/json",
                },
            )
            resp = conn.getresponse()
            resp.read()
            status = resp.status
            cookies = parse_set_cookies(resp)
        except http.client.HTTPException:
            raise TokenError("无法连接本机 %s 的 %s" % (port, REFRESH_PATH))
        except OSError:
            raise TokenError("无法连接本机 %s 的 %s" % (port, REFRESH_PATH))
    finally:
        conn.close()
    if status != 200:
        raise TokenError(
            "刷新失败（HTTP %s）。请重新从已登录页面复制 blade_token 和 blade_refresh_token"
            % status
        )
    access = cookies.get(ACCESS_COOKIE, "")
    rotated = cookies.get(REFRESH_COOKIE, "")
    if not access or not rotated:
        raise TokenError(
            "刷新接口没有同时返回新的 blade_token 和 blade_refresh_token，未写回凭据文件"
        )
    if not acceptable_secret(access) or not acceptable_secret(rotated):
        raise TokenError("刷新接口返回的票无法写入凭据文件")
    return access, rotated


def ensure_access_token():
    with _refresh_lock:
        return _ensure_locked(False, "")


def refresh_after_rejection(rejected):
    """Blade 在访问票本地 exp 之前就拒绝了它。有刷新票就轮换，没有就只记日志。"""
    with _refresh_lock:
        return _ensure_locked(True, rejected)


def _ensure_locked(force, rejected):
    path = token_path()
    with EnvLock(path):
        return _ensure_in_lock(path, force, rejected)


def _note_refresh_absent(access, force):
    if not access:
        return
    if access_expired(access):
        log_token_once("absent-expired", "refresh token absent, access token expired")
        return
    if force:
        log_token_once(
            "absent-rejected",
            "refresh token absent, upstream rejected access token",
        )
        return
    log_token_once("absent-soon", "refresh token absent, access token near expiry")


def _store_rotated(path, access, refresh):
    global _pending, _last_failure
    _pending = (access, refresh)
    try:
        write_tokens(path, access, refresh)
    except OSError:
        raise TokenError("已换到新票，但写回凭据文件失败。下次请求会重试写回，不会再次轮换")
    _pending = None
    _last_failure = ""
    clear_token_log("absent-expired", "absent-rejected", "absent-soon", "refresh-failed", "refresh-cooldown")
    log_token("refreshed access token and wrote rotated refresh token")
    return access


def _ensure_in_lock(path, force, rejected):
    global _pending, _last_attempt_at, _last_failure
    if _pending is not None:
        access, refresh = _pending
        return _store_rotated(path, access, refresh)
    access, refresh = configured_tokens(path)
    # 另一个进程已经写回新访问票时，不要再用旧的一次性刷新票轮换一次。
    if force and rejected and access and access != rejected and not needs_refresh(access):
        return access
    if access and not needs_refresh(access) and not (force and rejected and access == rejected):
        return access
    if not refresh:
        _note_refresh_absent(access, force)
        return access
    if not acceptable_secret(refresh):
        raise TokenError("EMBED_REFRESH_TOKEN 无法用于续期")
    if (
        _last_failure
        and _last_attempt_at
        and time.time() - _last_attempt_at < REFRESH_COOLDOWN_SECONDS
    ):
        log_token_once("refresh-cooldown", "refresh skipped during cooldown")
        if access and (force or not access_expired(access)):
            return access
        raise TokenError(_last_failure)
    _last_attempt_at = time.time()
    try:
        new_access, new_refresh = exchange_refresh(refresh)
    except TokenError as exc:
        _last_failure = str(exc)
        # 还没到期的访问票继续用。提前续期失败不能把正在用的票变成 503。
        if access and (force or not access_expired(access)):
            log_token_once("refresh-failed", _last_failure)
            return access
        raise
    return _store_rotated(path, new_access, new_refresh)


def rooted(root, path):
    path = path.split("?", 1)[0].split("#", 1)[0]
    trailing = path.endswith("/")
    path = posixpath.normpath(unquote(path))
    words = [word for word in path.split("/") if word and word not in (".", "..")]
    full = root
    for word in words:
        full = os.path.join(full, word)
    if trailing and words and not full.endswith(os.sep):
        full += os.sep
    return full


def has_file_suffix(path):
    base = posixpath.basename(path.rstrip("/"))
    return "." in base


# 调用方带了 Bearer 就用那张票。没带时才用服务端访问票。
# 响应里只有三个公用数量，不回票、不回技能正文、不回市场上架内容。
CATALOG_COUNTS_PATH = "/api/catalog-counts"
# 逐条调用 Blade Agent DELETE /api/sessions/{id}。不是一个事务。
# 必须使用调用方自己的 Authorization: Bearer，没有凭证就 401。
# 不改用 EMBED_TOKEN。本文件不用调用方 Cookie 做鉴权，因此这里不认 blade_token。
BATCH_DELETE_PATH = "/api/sessions/batch-delete"
BATCH_DELETE_LIMIT = 100
BATCH_DELETE_BODY_LIMIT = 32 * 1024
_AGENT_IDENTITY_KEYS = (
    "id",
    "listing_id",
    "service_id",
    "session_id",
    "os_app_id",
    "analytics_app_id",
    "app_id",
)


class CatalogError(Exception):
    pass


def _proxy_endpoint(prefix):
    for name, host, port in PROXIES:
        if name == prefix:
            return host, port
    raise CatalogError()


def _plain_text(value):
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, bool) or value is None:
        return ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float) and value == value and value not in (float("inf"), float("-inf")):
        return str(value)
    return ""


def _canonical_name(name):
    return re.sub(r"[\s\u3000]+", "", name.strip()).lower()


def count_public_skills(payload):
    """与展示页一致：is_preset 或 is_owner===false。当前账号自己的技能不计入。"""
    if not isinstance(payload, dict) or payload.get("ok") is False:
        raise CatalogError()
    skills = payload.get("skills")
    if not isinstance(skills, list):
        raise CatalogError()
    count = 0
    for item in skills:
        if not isinstance(item, dict):
            continue
        if item.get("is_preset") is True or item.get("is_owner") is False:
            count += 1
    return count


def count_public_plugins(payload):
    """Blade Hub GET /api/plugins。展示页会把 builtin 和 mine 都画出来。

    mine 是当前账号自己的插件，这里不计入。公用数量只取 builtin（内置）。
    """
    if not isinstance(payload, dict):
        raise CatalogError()
    builtin = payload.get("builtin")
    if builtin is None:
        return 0
    if not isinstance(builtin, list):
        raise CatalogError()
    return len(builtin)


def _agent_identity_ids(row):
    ids = []
    for key in _AGENT_IDENTITY_KEYS:
        value = _plain_text(row.get(key))
        if value and value not in ids:
            ids.append(value)
    return ids


def _is_public_agent(row):
    if row.get("is_preset") is True:
        return True
    status = _plain_text(row.get("status")).lower()
    return (not status) or status == "published"


def count_public_agents(payload):
    """市场 listings。公用 = status 为空或 published，或 is_preset。

    再按展示页的规则去重：相同 id、交叉的身份 id，或去掉空白后同名，只算一条。
    不并入当前账号的已安装列表和已发布应用。
    """
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict) and isinstance(payload.get("items"), list):
        rows = payload.get("items")
    else:
        raise CatalogError()
    kept = []
    for item in rows:
        if not isinstance(item, dict) or not _is_public_agent(item):
            continue
        item_id = _plain_text(item.get("id"))
        ids = _agent_identity_ids(item)
        name = _canonical_name(_plain_text(item.get("name")))
        duplicate = False
        for other_id, other_ids, other_name in kept:
            if item_id and other_id == item_id:
                duplicate = True
                break
            if any(value in other_ids for value in ids):
                duplicate = True
                break
            if name and name == other_name:
                duplicate = True
                break
        if not duplicate:
            kept.append((item_id, ids, name))
    return len(kept)


def _fetch_upstream_json(host, port, path, token):
    headers = {
        "Host": "%s:%s" % (host, port),
        "Accept": "application/json",
    }
    if token:
        headers["Authorization"] = "Bearer " + token
    conn = http.client.HTTPConnection(host, port, timeout=60)
    try:
        try:
            conn.request("GET", path, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
            status = resp.status
        except (OSError, http.client.HTTPException):
            raise CatalogError()
    finally:
        conn.close()
    if status == 401:
        return None
    if status != 200 or not data:
        raise CatalogError()
    try:
        parsed = json.loads(data.decode("utf-8"))
    except (UnicodeError, ValueError):
        raise CatalogError()
    if isinstance(parsed, str):
        raise CatalogError()
    return parsed


def _collect_catalog_counts(token):
    skills_host, skills_port = _proxy_endpoint("/api-ba")
    plugins_host, plugins_port = _proxy_endpoint("/api-bh")
    agents_host, agents_port = _proxy_endpoint("/api-bos")
    skills = _fetch_upstream_json(skills_host, skills_port, "/api/skill-store/catalog", token)
    plugins = _fetch_upstream_json(plugins_host, plugins_port, "/api/plugins", token)
    agents = _fetch_upstream_json(
        agents_host, agents_port, "/api/v1/market/listings?sort=recent", token
    )
    if skills is None or plugins is None or agents is None:
        return None
    return {
        "skills": count_public_skills(skills),
        "plugins": count_public_plugins(plugins),
        "agents": count_public_agents(agents),
    }


class BatchDeleteError(Exception):
    pass


def valid_session_id(value):
    """单个路径段。拒绝空串、过长，以及会改写删除地址的字符。"""
    if not isinstance(value, str) or not value or len(value) > 128:
        return False
    if value in (".", ".."):
        return False
    for char in value:
        if char <= " " or char in "/\\?#%":
            return False
    return True


def caller_bearer(header):
    """只认调用方带来的 Bearer。空的、非法的都不回落到服务端访问票。"""
    if not isinstance(header, str):
        return ""
    pieces = header.split(None, 1)
    if len(pieces) != 2 or pieces[0].lower() != "bearer":
        return ""
    token = pieces[1].strip()
    if not token or len(token) > 8192 or not acceptable_secret(token):
        return ""
    return token


def _content_length_value(header):
    if header is None or header == "":
        return 0
    try:
        length = int(header)
    except (TypeError, ValueError):
        return None
    if length < 0:
        return None
    return length


def parse_batch_delete_body(raw):
    if not raw:
        raise BatchDeleteError("invalid json")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError):
        raise BatchDeleteError("invalid json")
    if not isinstance(payload, dict):
        raise BatchDeleteError("invalid json")
    session_ids = payload.get("session_ids")
    if not isinstance(session_ids, list):
        raise BatchDeleteError("session_ids required")
    if len(session_ids) == 0:
        raise BatchDeleteError("session_ids required")
    if len(session_ids) > BATCH_DELETE_LIMIT:
        raise BatchDeleteError("too many session ids")
    cleaned = []
    for item in session_ids:
        if not valid_session_id(item):
            raise BatchDeleteError("invalid session id")
        cleaned.append(item)
    if "delete_workspace" not in payload or payload.get("delete_workspace") is None:
        delete_workspace = False
    elif isinstance(payload.get("delete_workspace"), bool):
        delete_workspace = payload.get("delete_workspace")
    else:
        raise BatchDeleteError("invalid delete_workspace")
    return cleaned, delete_workspace


def _upstream_error_text(status, data):
    if not data:
        return "upstream %s" % status
    try:
        parsed = json.loads(data.decode("utf-8"))
    except (UnicodeError, ValueError):
        return "upstream %s" % status
    if not isinstance(parsed, dict):
        return "upstream %s" % status
    for key in ("error", "detail", "message"):
        value = parsed.get(key)
        if not isinstance(value, str):
            continue
        text = " ".join(value.split())
        if not text or len(text) > 180:
            return "upstream %s" % status
        lowered = text.lower()
        if "bearer " in lowered or text.count(".") >= 2:
            return "upstream %s" % status
        return text
    return "upstream %s" % status


def _read_limited(resp, limit):
    chunks = []
    total = 0
    while total < limit:
        part = resp.read(limit - total)
        if not part:
            return b"".join(chunks)
        chunks.append(part)
        total += len(part)
    while resp.read(8192):
        pass
    return b"".join(chunks)


def delete_upstream_session(host, port, session_id, delete_workspace, token):
    flag = "true" if delete_workspace else "false"
    path = "/api/sessions/%s?delete_workspace=%s" % (quote(session_id, safe=""), flag)
    headers = {
        "Host": "%s:%s" % (host, port),
        "Accept": "application/json",
        "Authorization": "Bearer " + token,
    }
    conn = http.client.HTTPConnection(host, port, timeout=60)
    try:
        try:
            conn.request("DELETE", path, headers=headers)
            resp = conn.getresponse()
            data = _read_limited(resp, 512)
            status = resp.status
        except (OSError, http.client.HTTPException):
            return 502, "upstream unavailable"
    finally:
        conn.close()
    if 200 <= status < 300:
        return status, ""
    return status, _upstream_error_text(status, data)


def public_catalog_counts(token, allow_refresh=True):
    counts = _collect_catalog_counts(token)
    if counts is not None:
        return counts
    if not allow_refresh:
        raise CatalogError()
    try:
        refreshed = refresh_after_rejection(token)
    except TokenError:
        refreshed = ""
    if not refreshed or refreshed == token:
        raise CatalogError()
    counts = _collect_catalog_counts(refreshed)
    if counts is None:
        raise CatalogError()
    return counts


class EmbedHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        return rooted(ROOT, path)

    def end_headers(self):
        path = urlsplit(self.path).path
        if path == "/blade-site.js":
            self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", CSP)
        super().end_headers()

    def do_GET(self):
        self._route(static=True)

    def do_HEAD(self):
        self._route(static=True)

    def do_POST(self):
        self._route(static=False)

    def do_PUT(self):
        self._route(static=False)

    def do_PATCH(self):
        self._route(static=False)

    def do_DELETE(self):
        self._route(static=False)

    def do_OPTIONS(self):
        self._route(static=False)

    def _route(self, static):
        path = urlsplit(self.path).path
        if path == CATALOG_COUNTS_PATH:
            self._catalog_counts()
            return
        if path == BATCH_DELETE_PATH:
            self._batch_delete()
            return
        if path == "/embed-auth":
            self._embed_auth()
            return
        for prefix, host, port in PROXIES:
            if path == prefix or path.startswith(prefix + "/"):
                self._proxy(prefix, host, port)
                return
        if not static:
            self.send_error(405)
            return
        # 配置文件必须按 JS 返回。找不到时 404，不能改写成 index.html。
        if path == "/blade-site.js":
            self._serve_exact("blade-site.js", "application/javascript; charset=utf-8")
            return
        self._serve_spa(path)

    def _serve_spa(self, path):
        if path != "/":
            full = rooted(ROOT, path)
            probe = full[:-1] if full.endswith(os.sep) else full
            if os.path.isdir(probe):
                pass
            elif has_file_suffix(path):
                if not os.path.isfile(full):
                    self._plain(404, "not found\n")
                    return
            elif not os.path.isfile(full):
                self.path = "/index.html"
        if self.command == "HEAD":
            super().do_HEAD()
        else:
            super().do_GET()

    def _serve_exact(self, name, content_type):
        full = rooted(ROOT, "/" + name)
        if not os.path.isfile(full):
            self._plain(404, "not found\n")
            return
        with open(full, "rb") as handle:
            data = handle.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _plain(self, status, message):
        body = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _auth_json(self, status, payload, public=False):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if public:
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _catalog_counts(self):
        """调用方的 Bearer 优先。没有时才用服务端访问票。"""
        if self.command == "OPTIONS":
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Accept, Authorization")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.command not in ("GET", "HEAD"):
            self.send_error(405)
            return
        caller = caller_bearer(self.headers.get("Authorization"))
        allow_refresh = False
        if caller:
            token = caller
        else:
            try:
                token = ensure_access_token()
            except TokenError as exc:
                log_token(str(exc))
                self._auth_json(503, {"error": "catalog unavailable"}, public=True)
                return
            allow_refresh = True
        if not token:
            self._auth_json(503, {"error": "catalog unavailable"}, public=True)
            return
        try:
            counts = public_catalog_counts(token, allow_refresh)
        except CatalogError:
            self._auth_json(502, {"error": "catalog unavailable"}, public=True)
            return
        self._auth_json(200, counts, public=True)

    def _batch_delete(self):
        """调用方的 Bearer 原样转给 Blade Agent。没有凭证时不碰 EMBED_TOKEN。"""
        if self.command != "POST":
            self.send_error(405)
            return
        token = caller_bearer(self.headers.get("Authorization"))
        length = _content_length_value(self.headers.get("Content-Length"))
        if length is None or length > BATCH_DELETE_BODY_LIMIT:
            if not token:
                self._auth_json(401, {"error": "unauthorized"})
                return
            self._auth_json(400, {"error": "invalid body"})
            return
        raw = self.rfile.read(length) if length else b""
        if not token:
            self._auth_json(401, {"error": "unauthorized"})
            return
        try:
            session_ids, delete_workspace = parse_batch_delete_body(raw)
        except BatchDeleteError as exc:
            self._auth_json(400, {"error": str(exc)})
            return
        try:
            host, port = _proxy_endpoint("/api-ba")
        except CatalogError:
            self._auth_json(502, {"error": "upstream unavailable"})
            return
        deleted = []
        failed = []
        for session_id in session_ids:
            status, error = delete_upstream_session(
                host, port, session_id, delete_workspace, token
            )
            if 200 <= status < 300:
                deleted.append(session_id)
            else:
                failed.append({
                    "id": session_id,
                    "status": status,
                    "error": error or "upstream unavailable",
                })
        self._auth_json(200, {"deleted": deleted, "failed": failed})

    def _embed_auth(self):
        if self.command not in ("GET", "HEAD"):
            self.send_error(405)
            return
        site = (self.headers.get("Sec-Fetch-Site") or "").lower()
        dest = (self.headers.get("Sec-Fetch-Dest") or "").lower()
        if site == "cross-site" or dest == "document":
            self.send_error(404)
            return
        try:
            token = ensure_access_token()
        except TokenError as exc:
            log_token(str(exc))
            self._auth_json(503, {"token": "", "error": str(exc)}, public=True)
            return
        if not token:
            self._auth_json(503, {"token": "", "error": "未配置 EMBED_TOKEN"}, public=True)
            return
        self._auth_json(200, {"token": token}, public=True)

    def _forward(self, host, port, rest, body, token):
        headers = {"Host": "%s:%s" % (host, port)}
        for name in ("Content-Type", "Accept"):
            value = self.headers.get(name)
            if value:
                headers[name] = value
        if token:
            headers["Authorization"] = "Bearer " + token
        conn = http.client.HTTPConnection(host, port, timeout=60)
        try:
            conn.request(self.command, rest, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
            return resp.status, data, resp.getheader("Content-Type")
        finally:
            conn.close()

    def _proxy(self, prefix, host, port):
        length = int(self.headers.get("Content-Length") or 0)
        caller = caller_bearer(self.headers.get("Authorization"))
        owned = False
        if caller:
            token = caller
        else:
            try:
                token = ensure_access_token()
            except TokenError as exc:
                if length:
                    self.rfile.read(length)
                log_token(str(exc))
                self._plain(503, str(exc) + "\n")
                return
            owned = True
        rest = self.path[len(prefix):] or "/"
        body = self.rfile.read(length) if length else None
        try:
            status, data, content_type = self._forward(host, port, rest, body, token)
        except OSError:
            self._bad_gateway()
            return
        if status == 401 and owned and token and port in BLADE_AUTH_PORTS:
            try:
                refreshed = refresh_after_rejection(token)
            except TokenError as exc:
                log_token(str(exc))
                refreshed = ""
            if refreshed and refreshed != token:
                try:
                    status, data, content_type = self._forward(host, port, rest, body, refreshed)
                except OSError:
                    self._bad_gateway()
                    return
        self.send_response(status)
        if content_type:
            self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD" and data:
            self.wfile.write(data)

    def _bad_gateway(self):
        message = b"bad gateway"
        self.send_response(502)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(message)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(message)

    def log_message(self, fmt, *args):
        path = self.path.split("?", 1)[0]
        if path == "/embed-auth":
            super().log_message("%s /embed-auth", self.command)
            return
        if path == BATCH_DELETE_PATH:
            super().log_message("%s %s", self.command, BATCH_DELETE_PATH)
            return
        super().log_message(fmt, *args)


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), EmbedHandler)
    print("embed-app listening on 0.0.0.0:%s" % PORT, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
