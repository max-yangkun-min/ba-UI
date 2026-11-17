#!/usr/bin/env python3
"""Serve embed-app and reverse-proxy its API prefixes to local Blade ports.

Access tickets are renewed on this host. /embed-auth and ordinary proxy
calls that have no caller ticket still check the exp of EMBED_TOKEN. When
less than an hour remains, or Blade Agent / Blade Hub returns 401 for that
server ticket, the service exchanges EMBED_REFRESH_TOKEN at local Blade
Agent POST /api/auth/refresh. That call rotates the refresh ticket, so the
new access ticket and the new refresh ticket are written back to the proxy
env file before another refresh can start. A missing refresh ticket does
not drop a configured access ticket; the reason is logged.

Portal catalog reads, portal install/add, and the reads used to open an
experience send X-Blade-Portal-Catalog: 1. Those requests drop the caller
ticket. If the server access ticket is missing, near expiry, or Blade
rejects it, this process logs in again with EMBED_USERNAME / EMBED_PASSWORD
(defaults are in this file). Login follows the 8020 redirect to the auth
service: GET /api/v1/crypto/pubkey, then POST /api/v1/auth/login. The new
access ticket is written back. A new refresh ticket is written only when
login actually returns one. The next failure logs in with the account
again and does not depend on the refresh ticket just written.

If the caller sends Authorization: Bearer, /api-ba, /api-bh, /api-bos,
/api-llm and /api/catalog-counts forward that ticket and do not replace it.
Other writes keep the caller ticket. Batch delete never falls back to
EMBED_TOKEN. Chat, /embed-auth, and blade-embed-logout are unchanged.
"""

import base64
import hashlib
import json
import os
import posixpath
import re
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qs, quote, unquote, urlsplit

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
# /api-bos 的端口在 read_env 之后写入 PROXIES：BOS_PORT，默认 80。

# blade-auth-client 默认 cookie，与 iframe 插件 autologin.html 一致。
# POST /api/auth/refresh 只读刷新票，成功时 Set-Cookie 同时下发新的两张票。
ACCESS_COOKIE = "blade_token"
REFRESH_COOKIE = "blade_refresh_token"
REFRESH_PATH = "/api/auth/refresh"
# 距过期不足 1 小时就续期，已过期同样续期。上游 401 不等到这一小时。
REFRESH_WITHIN_SECONDS = 3600
# 刚换过票仍被拒绝时，不要每个请求都轮换一次一次性刷新票，也不要连续打登录。
REFRESH_COOLDOWN_SECONDS = 60
# 门户目录换票用的固定账号。进程环境或凭据文件里的 EMBED_USERNAME / EMBED_PASSWORD 可以覆盖。
DEFAULT_USERNAME = "superadmin"
DEFAULT_PASSWORD = "superadmin123"
# 只有这两端口的 401 表示访问票被 Blade 拒绝。其它反代的 401 不换票。
BLADE_AUTH_PORTS = (8020, 8010)

_refresh_lock = threading.Lock()
# 换票已经成功但写回失败时留在内存里。下次只重试写回，不再用旧刷新票轮换一次。
_pending = None
_last_attempt_at = 0.0
_last_failure = ""
_portal_pending = None
_portal_last_attempt_at = 0.0
_portal_last_failure = ""
_portal_expires_at = 0.0
_auth_origin = ""
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


def configured_port(name, default):
    """进程环境优先，其次 proxy.env。空值用 default。非法值退回 default，不中断服务。"""
    raw = os.environ.get(name, "").strip()
    if not raw:
        try:
            raw = read_env(token_path()).get(name, "").strip()
        except (OSError, UnicodeError):
            raw = ""
    if not raw:
        return default
    port = int(raw) if raw.isdigit() else 0
    if 1 <= port <= 65535:
        return port
    sys.stderr.write("embed-app: %s 不是有效端口，仍使用 %s\n" % (name, default))
    sys.stderr.flush()
    return default


# 开发空间、管理空间的跳转地址。
# 现场文件是 /opt/embed-app/space-urls.json（与 proxy.env 同目录）。
# 进程环境 DEV_SPACE_URL、ADMIN_SPACE_URL 优先，其次 proxy.env 里的同名项，最后才读 JSON。
# 空字符串表示该标签不跳转。GET /api/space-urls 只返回 {"dev","admin"}，不需要登录。
SPACE_URLS_PATH = "/api/space-urls"
SPACE_URL_LIMIT = 2048


def space_urls_file():
    override = os.environ.get("EMBED_SPACE_URLS", "").strip()
    if override:
        return override
    directory = os.path.dirname(os.path.abspath(token_path())) or "."
    return os.path.join(directory, "space-urls.json")


def clean_space_url(value):
    if not isinstance(value, str):
        return ""
    text = value.strip()
    if not text or len(text) > SPACE_URL_LIMIT:
        return ""
    for char in text:
        if char <= " " or char in "<>\"'`":
            return ""
    lower = text.lower()
    if not (lower.startswith("http://") or lower.startswith("https://")):
        return ""
    return text


def _json_without_comments(raw):
    lines = []
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("//"):
            continue
        lines.append(line)
    return "\n".join(lines)


def _urls_from_mapping(data):
    if not isinstance(data, dict):
        return "", ""
    return clean_space_url(data.get("dev")), clean_space_url(data.get("admin"))


def _read_space_file(path):
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            raw = handle.read()
        parsed = json.loads(_json_without_comments(raw) or "{}")
    except (OSError, UnicodeError, ValueError):
        return None
    if not isinstance(parsed, dict):
        return None
    return _urls_from_mapping(parsed)


def load_space_urls():
    """给 /api/space-urls。不读取、不返回访问票。"""
    path = space_urls_file()
    if os.path.isfile(path):
        found = _read_space_file(path)
        dev, admin = found if found is not None else ("", "")
    else:
        example = path + ".example" if not path.endswith(".example") else ""
        found = _read_space_file(example) if example else None
        dev, admin = found if found is not None else ("", "")
    try:
        values = read_env(token_path())
    except (OSError, UnicodeError):
        values = {}
    if "DEV_SPACE_URL" in values:
        dev = clean_space_url(values.get("DEV_SPACE_URL", ""))
    if "ADMIN_SPACE_URL" in values:
        admin = clean_space_url(values.get("ADMIN_SPACE_URL", ""))
    if "DEV_SPACE_URL" in os.environ:
        dev = clean_space_url(os.environ.get("DEV_SPACE_URL", ""))
    if "ADMIN_SPACE_URL" in os.environ:
        admin = clean_space_url(os.environ.get("ADMIN_SPACE_URL", ""))
    return {"dev": dev, "admin": admin}


# 应用市场（Blade OS）。实验室和旧安装是 80。现场改到 8099 时在 proxy.env 写 BOS_PORT=8099。
PROXIES = (
    ("/api-ba", "127.0.0.1", 8020),
    ("/api-llm", "127.0.0.1", 30000),
    ("/api-bh", "127.0.0.1", 8010),
    ("/api-bos", "127.0.0.1", configured_port("BOS_PORT", 80)),
)


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


def write_tokens(path, access, refresh, expires_at=None):
    mode = 0o600
    original = ""
    if os.path.isfile(path):
        mode = os.stat(path).st_mode & 0o777
        with open(path, encoding="utf-8") as handle:
            original = handle.read()
    lines = upsert_line(original.splitlines(), "EMBED_TOKEN", access)
    if refresh:
        lines = upsert_line(lines, "EMBED_REFRESH_TOKEN", refresh)
    if expires_at:
        lines = upsert_line(lines, "EMBED_ACCESS_EXPIRES_AT", str(int(expires_at)))
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


def portal_account():
    """进程环境优先，其次凭据文件，最后用代码里的固定账号。"""
    try:
        values = read_env(token_path())
    except (OSError, UnicodeError, TokenError):
        values = {}
    username = os.environ.get("EMBED_USERNAME", "").strip() or values.get("EMBED_USERNAME", "").strip()
    password = os.environ.get("EMBED_PASSWORD", "") or values.get("EMBED_PASSWORD", "")
    return username or DEFAULT_USERNAME, password or DEFAULT_PASSWORD


def _der_len(data, index):
    first = data[index]
    index += 1
    if first < 0x80:
        return first, index
    count = first & 0x7F
    if count == 0 or count > 4:
        raise TokenError("登录公钥无法解析")
    length = int.from_bytes(data[index:index + count], "big")
    return length, index + count


def _der_tlv(data, index):
    if index >= len(data):
        raise TokenError("登录公钥无法解析")
    tag = data[index]
    index += 1
    length, index = _der_len(data, index)
    end = index + length
    if end > len(data):
        raise TokenError("登录公钥无法解析")
    return tag, data[index:end], end


def _rsa_public(pem):
    body = "".join(line.strip() for line in pem.splitlines() if line.strip() and "-----" not in line)
    try:
        der = base64.b64decode(body)
    except (ValueError, TypeError):
        raise TokenError("登录公钥无法解析")
    tag, spki, _ = _der_tlv(der, 0)
    if tag != 0x30:
        raise TokenError("登录公钥无法解析")
    tag, _algorithm, cursor = _der_tlv(spki, 0)
    if tag != 0x30:
        raise TokenError("登录公钥无法解析")
    tag, bit, _ = _der_tlv(spki, cursor)
    if tag != 0x03 or not bit or bit[0] != 0:
        raise TokenError("登录公钥无法解析")
    tag, seq, _ = _der_tlv(bit, 1)
    if tag != 0x30:
        raise TokenError("登录公钥无法解析")
    tag, modulus, cursor = _der_tlv(seq, 0)
    if tag != 0x02:
        raise TokenError("登录公钥无法解析")
    tag, exponent, _ = _der_tlv(seq, cursor)
    if tag != 0x02:
        raise TokenError("登录公钥无法解析")
    return int.from_bytes(modulus, "big"), int.from_bytes(exponent, "big")


def _mgf1(seed, length):
    output = b""
    counter = 0
    while len(output) < length:
        output += hashlib.sha256(seed + counter.to_bytes(4, "big")).digest()
        counter += 1
    return output[:length]


def _encrypt_password(public_key, password):
    """与认证桥相同：RSA-OAEP-SHA256 加密 {"p":"<口令>"}，再做成无填充 base64url。"""
    modulus, exponent = _rsa_public(public_key)
    message = json.dumps({"p": password}, separators=(",", ":")).encode("utf-8")
    size = (modulus.bit_length() + 7) // 8
    hash_len = 32
    if len(message) > size - 2 * hash_len - 2:
        raise TokenError("登录口令无法加密")
    label_hash = hashlib.sha256(b"").digest()
    padding = b"\x00" * (size - len(message) - 2 * hash_len - 2)
    data_block = label_hash + padding + b"\x01" + message
    seed = os.urandom(hash_len)
    data_mask = _mgf1(seed, size - hash_len - 1)
    masked_data = bytes(left ^ right for left, right in zip(data_block, data_mask))
    seed_mask = _mgf1(masked_data, hash_len)
    masked_seed = bytes(left ^ right for left, right in zip(seed, seed_mask))
    encoded = b"\x00" + masked_seed + masked_data
    cipher = pow(int.from_bytes(encoded, "big"), exponent, modulus)
    return base64.urlsafe_b64encode(cipher.to_bytes(size, "big")).decode("ascii").rstrip("=")


def _origin_from_location(location):
    parts = urlsplit(location or "")
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return ""
    origin = "%s://%s" % (parts.scheme, parts.hostname)
    if parts.port:
        origin += ":%s" % parts.port
    return origin


def _http_json(method, origin, path, payload=None):
    parts = urlsplit(origin)
    host = parts.hostname or ""
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if not host:
        raise TokenError("无法连接认证服务")
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    conn = http.client.HTTPConnection(host, port, timeout=20)
    try:
        try:
            conn.request(method, path, body=body, headers=headers)
            resp = conn.getresponse()
            raw = resp.read()
            status = resp.status
            cookies = parse_set_cookies(resp)
        except http.client.HTTPException:
            raise TokenError("无法连接认证服务")
        except OSError:
            raise TokenError("无法连接认证服务")
    finally:
        conn.close()
    try:
        data = json.loads(raw.decode("utf-8")) if raw else None
    except (UnicodeError, ValueError):
        data = None
    if not isinstance(data, dict):
        data = {}
    return status, data, cookies


def auth_origin():
    """8020 的 GET /api/auth/login 会 302 到认证服务。只取来源，不跟随跳转。"""
    global _auth_origin
    override = os.environ.get("EMBED_AUTH_BASE", "").strip().rstrip("/")
    if not override:
        try:
            override = read_env(token_path()).get("EMBED_AUTH_BASE", "").strip().rstrip("/")
        except (OSError, UnicodeError, TokenError):
            override = ""
    if override:
        return override
    if _auth_origin:
        return _auth_origin
    host, port = refresh_target()
    conn = http.client.HTTPConnection(host, port, timeout=20)
    try:
        try:
            nxt = quote("http://%s:%s/" % (host, port), safe="")
            conn.request("GET", "/api/auth/login?next=" + nxt, headers={"Accept": "application/json"})
            resp = conn.getresponse()
            location = resp.getheader("Location") or ""
            resp.read()
        except http.client.HTTPException:
            raise TokenError("无法连接本机 %s 的 /api/auth/login" % port)
        except OSError:
            raise TokenError("无法连接本机 %s 的 /api/auth/login" % port)
    finally:
        conn.close()
    origin = _origin_from_location(location)
    if not origin:
        raise TokenError("登录入口没有返回认证服务地址")
    _auth_origin = origin
    return origin


def exchange_login(username, password):
    """认证服务登录。成功正文给出 access_token；有刷新票才返回第二项。"""
    origin = auth_origin()
    status, data, _cookies = _http_json("GET", origin, "/api/v1/crypto/pubkey")
    public_key = data.get("public_key") if status == 200 else ""
    kid = data.get("kid") if status == 200 else ""
    if not isinstance(public_key, str) or not public_key or not isinstance(kid, str) or not kid:
        raise TokenError("认证服务没有返回登录公钥")
    status, data, cookies = _http_json(
        "POST",
        origin,
        "/api/v1/auth/login",
        {
            "username": username,
            "password_enc": _encrypt_password(public_key, password),
            "enc_kid": kid,
        },
    )
    access = data.get("access_token") if isinstance(data.get("access_token"), str) else ""
    if not access:
        access = cookies.get(ACCESS_COOKIE, "")
    refresh = data.get("refresh_token") if isinstance(data.get("refresh_token"), str) else ""
    if not refresh:
        refresh = cookies.get(REFRESH_COOKIE, "")
    if status != 200 or not acceptable_secret(access):
        raise TokenError("账号登录失败")
    if refresh and not acceptable_secret(refresh):
        refresh = ""
    expires_in = data.get("expires_in")
    expires_at = None
    if isinstance(expires_in, (int, float)) and not isinstance(expires_in, bool) and expires_in > 0:
        expires_at = time.time() + float(expires_in)
    return access, refresh, expires_at


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


def ensure_portal_access():
    """门户目录自己的票。缺失、快过期时用固定账号重登，不靠刷新票。"""
    with _refresh_lock:
        return _ensure_portal_locked(False, "")


def portal_login_after_rejection(rejected):
    """门户请求被 401 拒绝后用账号再登。刚写下的刷新票不算下一张可用票。"""
    with _refresh_lock:
        return _ensure_portal_locked(True, rejected)


def _saved_portal_expiry(path, token):
    if access_exp(token) is not None:
        return 0.0
    try:
        raw = read_env(path).get("EMBED_ACCESS_EXPIRES_AT", "").strip()
    except (OSError, UnicodeError):
        return 0.0
    try:
        value = float(raw)
    except ValueError:
        return 0.0
    return value if value > 0 else 0.0


def _portal_exp(token):
    exp = access_exp(token)
    if exp is not None:
        return exp
    return _portal_expires_at or None


def _portal_needs_renewal(token, now=None):
    exp = _portal_exp(token)
    if exp is None:
        return False
    if now is None:
        now = time.time()
    return exp - now < REFRESH_WITHIN_SECONDS


def _portal_expired(token, now=None):
    exp = _portal_exp(token)
    if exp is None:
        return False
    if now is None:
        now = time.time()
    return exp <= now


def _store_portal(path, access, refresh, expires_at=None):
    global _portal_pending, _portal_last_failure, _portal_expires_at
    if expires_at:
        _portal_expires_at = float(expires_at)
    _portal_pending = (access, refresh, _portal_expires_at or None)
    try:
        write_tokens(path, access, refresh, _portal_expires_at or None)
    except OSError:
        raise TokenError("已换到新票，但写回凭据文件失败。下次请求会重试写回，不会再次登录")
    _portal_pending = None
    _portal_last_failure = ""
    clear_token_log("login-failed")
    log_token("logged in with configured account and wrote access token")
    return access


def _ensure_portal_locked(force, rejected):
    path = token_path()
    with EnvLock(path):
        return _ensure_portal_in_lock(path, force, rejected)


def _ensure_portal_in_lock(path, force, rejected):
    global _portal_pending, _portal_last_attempt_at, _portal_last_failure, _portal_expires_at
    if _portal_pending is not None:
        access, refresh, expires_at = _portal_pending
        return _store_portal(path, access, refresh, expires_at)
    access, refresh = configured_tokens(path)
    if not _portal_expires_at:
        _portal_expires_at = _saved_portal_expiry(path, access)
    if force and rejected and access and access != rejected and not _portal_needs_renewal(access):
        return access
    if access and not _portal_needs_renewal(access) and not (force and rejected and access == rejected):
        return access
    if (
        _portal_last_failure
        and _portal_last_attempt_at
        and time.time() - _portal_last_attempt_at < REFRESH_COOLDOWN_SECONDS
    ):
        log_token_once("login-cooldown", "account login skipped during cooldown")
        if access and (force or not _portal_expired(access)):
            return access
        raise TokenError(_portal_last_failure)
    _portal_last_attempt_at = time.time()
    username, password = portal_account()
    try:
        new_access, new_refresh, expires_at = exchange_login(username, password)
    except TokenError as exc:
        _portal_last_failure = str(exc)
        if access and (force or not _portal_expired(access)):
            log_token_once("login-failed", _portal_last_failure)
            return access
        raise
    if not new_refresh:
        new_refresh = refresh
    return _store_portal(path, new_access, new_refresh, expires_at)


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


def _query_value(query, key):
    values = parse_qs(query, keep_blank_values=False).get(key) or []
    return values[0] if values else ""


def portal_catalog_request(method, raw_path, header):
    """门户展示。列表和详情只认 GET/HEAD。安装和添加不换超级管理员，沿用调用方的票。"""
    if not isinstance(header, str) or header.strip() != "1":
        return False
    parts = urlsplit(raw_path or "")
    path = parts.path.rstrip("/") or "/"
    if method == "POST":
        if path == "/api-bh/api/resources/test":
            return True
        return False
    if method not in ("GET", "HEAD"):
        return False
    if path == "/api-ba/api/skill-store/catalog":
        return True
    if path == "/api-ba/api/registry/kb":
        return _query_value(parts.query, "scope") == "market"
    if re.fullmatch(r"/api-ba/api/registry/kb/[^/]+", path):
        return True
    if path == "/api-ba/api/market-publish/listings":
        return True
    if path == "/api-ba/api/published-apps":
        return True
    if re.fullmatch(r"/api-ba/api/published-apps/[^/]+", path):
        return True
    if path == "/api-bh/api/resources":
        return _query_value(parts.query, "type") == "tool"
    if re.fullmatch(r"/api-bh/api/resources/[^/]+", path):
        return True
    if path == "/api-bh/api/plugins":
        return True
    if re.fullmatch(r"/api-bh/api/plugins/[^/]+", path):
        return True
    if re.fullmatch(r"/api-bh/api/skills/[^/]+/[^/]+", path):
        return True
    if path == "/api-bos/api/v1/market/listings":
        return True
    if re.fullmatch(r"/api-bos/api/v1/market/listings/[^/]+", path):
        return True
    if re.fullmatch(r"/api-bos/api/v1/market/listings/[^/]+/screenshots/[^/]+/image", path):
        return True
    if path == "/api-bos/api/v1/market/installed":
        return True
    if path == "/api/catalog-counts":
        return True
    return False


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


def public_catalog_counts(token, allow_refresh=True, portal=False):
    counts = _collect_catalog_counts(token)
    if counts is not None:
        return counts
    if not allow_refresh:
        raise CatalogError()
    try:
        if portal:
            refreshed = portal_login_after_rejection(token)
        else:
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
        if path == "/blade-site.js" or path == "/portal-login.js":
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
        if path == SPACE_URLS_PATH:
            self._space_urls()
            return
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
        if path == "/portal-login.js":
            self._serve_exact("portal-login.js", "application/javascript; charset=utf-8")
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

    def _space_urls(self):
        """开发空间、管理空间地址。不校验登录，响应里只有两个 URL。"""
        if self.command == "OPTIONS":
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Accept")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.command not in ("GET", "HEAD"):
            self.send_error(405)
            return
        self._auth_json(200, load_space_urls(), public=True)

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
        portal = portal_catalog_request(
            self.command, self.path, self.headers.get("X-Blade-Portal-Catalog")
        )
        caller = "" if portal else caller_bearer(self.headers.get("Authorization"))
        allow_refresh = False
        if caller:
            token = caller
        else:
            try:
                token = ensure_portal_access() if portal else ensure_access_token()
            except TokenError as exc:
                log_token(str(exc))
                self._auth_json(503, {"error": "catalog unavailable"}, public=True)
                return
            allow_refresh = True
        if not token:
            self._auth_json(503, {"error": "catalog unavailable"}, public=True)
            return
        try:
            counts = public_catalog_counts(token, allow_refresh, portal)
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
        portal = portal_catalog_request(
            self.command, self.path, self.headers.get("X-Blade-Portal-Catalog")
        )
        caller = "" if portal else caller_bearer(self.headers.get("Authorization"))
        owned = False
        if caller:
            token = caller
        else:
            try:
                token = ensure_portal_access() if portal else ensure_access_token()
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
        if status == 401 and owned and token and (portal or port in BLADE_AUTH_PORTS):
            try:
                if portal:
                    refreshed = portal_login_after_rejection(token)
                else:
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
