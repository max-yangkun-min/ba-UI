#!/usr/bin/env python3
"""Serve the optional integration shell. Python 3 standard library only."""

import json
import os
import posixpath
from urllib.parse import unquote, urlsplit

import http.client

try:
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
except ImportError:
    from http.server import HTTPServer, SimpleHTTPRequestHandler
    from socketserver import ThreadingMixIn

    class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
        daemon_threads = True

ROOT = os.environ.get("SHELL_ROOT", "/opt/public-service/dist")
PORT = int(os.environ.get("SHELL_PORT", "5173"))
PORTAL_ENV = os.environ.get("PORTAL_ENV", "/opt/public-service/portal.env")
CUSTOMER_PREFIX = "/login-test-api/customer"
BRIDGE_PREFIX = "/login-test-api/bridge"
BODY_LIMIT = 64 * 1024


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


def portal_origins():
    try:
        values = read_env(PORTAL_ENV)
    except (OSError, UnicodeError):
        values = {}
    customer = os.environ.get("CUSTOMER_ORIGIN", "").strip() or values.get("CUSTOMER_ORIGIN", "").strip()
    bridge = os.environ.get("BRIDGE_ORIGIN", "").strip() or values.get("BRIDGE_ORIGIN", "").strip()
    if not bridge:
        bridge = "http://127.0.0.1:9000"
    return customer.rstrip("/"), bridge.rstrip("/")


def parse_origin(origin):
    parts = urlsplit(origin)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    if parts.username or parts.password or parts.query or parts.fragment:
        return None
    if parts.path not in ("", "/"):
        return None
    port = parts.port
    if port is None:
        port = 443 if parts.scheme == "https" else 80
    return parts.scheme, parts.hostname, port


class ShellHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        return rooted(ROOT, path)

    def end_headers(self):
        if urlsplit(self.path).path == "/shell-site.js":
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        self._route()

    def do_HEAD(self):
        self._route()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == CUSTOMER_PREFIX or path.startswith(CUSTOMER_PREFIX + "/"):
            self._login_proxy(CUSTOMER_PREFIX, "customer")
            return
        if path == BRIDGE_PREFIX or path.startswith(BRIDGE_PREFIX + "/"):
            self._login_proxy(BRIDGE_PREFIX, "bridge")
            return
        self._plain(404, "not found\n")

    def _login_proxy(self, prefix, kind):
        customer, bridge = portal_origins()
        origin = customer if kind == "customer" else bridge
        if kind == "customer" and not customer:
            self._json(503, {"detail": "customer login is not configured"})
            return
        parsed = parse_origin(origin)
        if parsed is None:
            self._json(503, {"detail": "upstream is not configured"})
            return
        scheme, host, port = parsed
        length_raw = self.headers.get("Content-Length")
        try:
            length = int(length_raw or "0")
        except ValueError:
            self._json(400, {"detail": "invalid body"})
            return
        if length < 0 or length > BODY_LIMIT:
            self._json(400, {"detail": "invalid body"})
            return
        body = self.rfile.read(length) if length else None
        rest = self.path[len(prefix):] or "/"
        if not rest.startswith("/"):
            rest = "/" + rest
        headers = {"Host": host if port in (80, 443) else "%s:%s" % (host, port)}
        for name in ("Content-Type", "Accept", "Authorization"):
            value = self.headers.get(name)
            if value:
                headers[name] = value
        connection = http.client.HTTPSConnection if scheme == "https" else http.client.HTTPConnection
        conn = connection(host, port, timeout=60)
        try:
            conn.request("POST", rest, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read(1024 * 1024)
            status = resp.status
            content_type = resp.getheader("Content-Type")
        except (OSError, http.client.HTTPException):
            self._plain(502, "bad gateway\n")
            return
        finally:
            conn.close()
        self.send_response(status)
        if content_type:
            self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if data:
            self.wfile.write(data)

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _route(self):
        path = urlsplit(self.path).path
        if path == "/shell-site.js":
            self._serve_exact("shell-site.js", "application/javascript; charset=utf-8")
            return
        if path != "/":
            full = rooted(ROOT, path)
            probe = full[:-1] if full.endswith(os.sep) else full
            if os.path.isdir(probe):
                pass
            elif has_file_suffix(path) or path.startswith("/assets/"):
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


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), ShellHandler)
    print("public-service listening on 0.0.0.0:%s" % PORT, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
