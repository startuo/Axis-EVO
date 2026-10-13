"""Loopback-only, GET-only stdlib server for the opt-in Web Workbench.

Launch from the repository root: python -m web_api.app --port 8765
No GET initializes a schema, executes a tool or contacts a model provider.
"""

import argparse
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import socket
from socketserver import ThreadingMixIn
import threading
from urllib.parse import parse_qs, unquote, urlsplit

from .read_facade import ReadFacade
from .schemas import (ApiError, MAX_RESPONSE_BYTES, MAX_LIST_ITEMS, MAX_EVENT_ITEMS,
                      WorkbenchConfig, envelope, no_redirected_parents)


_STATIC_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
                 ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
                 ".woff2": "font/woff2", ".woff": "font/woff"}
_MAX_STATIC_BYTES = 8 * 1024 * 1024
_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "connect-src 'self'; img-src 'self' data:; font-src 'self'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'none'")


class WorkbenchServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address, facade, *, web_root=None, allowed_origins=()):
        if address[0] != "127.0.0.1":
            raise ValueError("The Workbench bridge binds only to 127.0.0.1")
        self.facade = facade
        self.web_root = None
        if web_root is not None:
            root = Path(web_root).absolute()
            no_redirected_parents(root)
            root = root.resolve(strict=True)
            if not root.is_dir() or not (root / "index.html").is_file():
                raise ValueError("A built frontend directory with index.html is required")
            self.web_root = root
        self._slots = threading.BoundedSemaphore(4)
        super().__init__(address, WorkbenchHandler)
        self.origin = f"http://127.0.0.1:{self.server_port}"
        # The checked-in Vite configuration proxies without rewriting Host.
        # This explicit development origin is never reflected as arbitrary CORS.
        origins = {self.origin, "http://127.0.0.1:5173", *allowed_origins, *facade.config.allowed_origins}
        for origin in origins:
            parsed = urlsplit(origin)
            if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port
                    or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
                self.server_close()
                raise ValueError("Only exact loopback origins are supported")
        self.allowed_origins = frozenset(origins)
        self.allowed_hosts = frozenset(urlsplit(origin).netloc for origin in origins)

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()

    def handle_error(self, request, client_address):
        # No provider, filesystem, query string or stored record is logged.
        pass


class WorkbenchHandler(BaseHTTPRequestHandler):
    server_version = "AxisEvoReadBridge/1"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(5.0)

    def log_message(self, format, *args):
        pass

    def _headers(self, status, content_type, length):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", _CSP)
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()

    def _json(self, status, data):
        try:
            raw = json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        except (ValueError, TypeError, UnicodeError, RecursionError):
            status = 500
            raw = b'{"error":{"code":"INVALID_RESPONSE","message":"A safe response is unavailable."}}'
        if len(raw) > MAX_RESPONSE_BYTES:
            status = 413
            raw = b'{"error":{"code":"RESPONSE_LIMIT","message":"The response exceeds the Web inspection budget."}}'
        self._headers(status, "application/json; charset=utf-8", len(raw))
        if self.command != "HEAD":
            self.wfile.write(raw)

    def send_error(self, code, message=None, explain=None):
        self.close_connection = True
        self._json(code, {"error": {"code": "HTTP_REJECTED", "message": "The request is not supported."}})

    def _request_boundary(self):
        if len(self.path) > 2048:
            raise ApiError("REQUEST_LIMIT", "The request exceeds the Web budget.", 414)
        hosts = self.headers.get_all("Host", [])
        if len(hosts) != 1 or hosts[0] not in self.server.allowed_hosts:
            raise ApiError("HOST_REJECTED", "The request Host is not allowed.", 403)
        origins = self.headers.get_all("Origin", [])
        if len(origins) > 1 or origins and origins[0] not in self.server.allowed_origins:
            raise ApiError("ORIGIN_REJECTED", "The request Origin is not allowed.", 403)
        site = self.headers.get("Sec-Fetch-Site")
        if site is not None and site not in ("same-origin", "same-site", "none"):
            raise ApiError("ORIGIN_REJECTED", "Cross-site requests are not allowed.", 403)
        parsed = urlsplit(self.path)
        if parsed.scheme or parsed.netloc or parsed.fragment:
            raise ApiError("INVALID_PATH", "An application-relative route is required.")
        try:
            path = unquote(parsed.path, encoding="utf-8", errors="strict")
        except UnicodeError:
            raise ApiError("INVALID_PATH", "The route is invalid.") from None
        if ("\\" in path or "\x00" in path or ":" in path
                or any(p in (".", "..") for p in path.split("/"))):
            raise ApiError("INVALID_PATH", "The route is invalid.")
        return path, parsed.query

    @staticmethod
    def _query(raw, allowed):
        try:
            values = parse_qs(raw, keep_blank_values=True, strict_parsing=True, max_num_fields=4,
                              encoding="utf-8", errors="strict") if raw else {}
            if not values.keys() <= allowed or any(len(v) != 1 for v in values.values()):
                raise ValueError("unexpected query")
            return values
        except (ValueError, UnicodeError):
            raise ApiError("INVALID_QUERY", "Only supported bounded pagination is accepted.") from None

    @staticmethod
    def _integer(values, key, default, lower, upper):
        raw = values.get(key, [str(default)])[0]
        if not raw.isascii() or not raw.isdecimal() or len(raw) > 9:
            raise ApiError("INVALID_QUERY", "Pagination must use bounded nonnegative integers.")
        value = int(raw)
        if not lower <= value <= upper:
            raise ApiError("INVALID_QUERY", "Pagination is outside the supported budget.")
        return value

    def _api(self, path, raw_query):
        parts = path.strip("/").split("/")
        facade = self.server.facade
        if parts == ["api", "health"]:
            self._query(raw_query, set())
            return facade.health()
        if parts == ["api", "projects"]:
            self._query(raw_query, set())
            return facade.projects()
        if len(parts) < 4 or parts[:2] != ["api", "projects"]:
            raise ApiError("ROUTE_NOT_FOUND", "The read-only route does not exist.", 404)
        project, resource = parts[2], parts[3]
        if resource == "runs":
            if len(parts) == 4:
                query = self._query(raw_query, {"limit"})
                return facade.runs(project, limit=self._integer(query, "limit", MAX_LIST_ITEMS, 1, MAX_LIST_ITEMS))
            if len(parts) == 5:
                self._query(raw_query, set())
                return facade.run(project, parts[4])
            if len(parts) == 6 and parts[5] == "events":
                query = self._query(raw_query, {"after", "limit"})
                return facade.events(project, parts[4], after=self._integer(query, "after", 0, 0, 1_000_000),
                                     limit=self._integer(query, "limit", MAX_EVENT_ITEMS, 1, MAX_EVENT_ITEMS))
        if resource == "skills":
            self._query(raw_query, set())
            if len(parts) == 4:
                return facade.skills(project)
            if len(parts) == 6:
                if not parts[5].isascii() or not parts[5].isdecimal() or len(parts[5]) > 9:
                    raise ApiError("INVALID_ID", "An exact positive Skill version is required.")
                return facade.skill(project, parts[4], int(parts[5]))
        if resource == "evolution":
            self._query(raw_query, set())
            if len(parts) == 4:
                return facade.evolution_cases(project)
            if len(parts) == 5:
                return facade.evolution(project, parts[4])
        raise ApiError("ROUTE_NOT_FOUND", "The read-only route does not exist.", 404)

    def _static(self, path, query):
        if query:
            raise ApiError("INVALID_QUERY", "Static resources do not accept filesystem parameters.")
        root = self.server.web_root
        if root is None:
            raise ApiError("FRONTEND_UNAVAILABLE", "Build the frontend or use the Vite development server.", 404)
        relative = path.lstrip("/")
        if any(p.startswith(".") for p in relative.split("/") if p):
            raise ApiError("ROUTE_NOT_FOUND", "The static resource does not exist.", 404)
        target = root / relative if relative else root / "index.html"
        if not target.suffix:
            target = root / "index.html"
        try:
            no_redirected_parents(target)
            target = target.resolve(strict=True)
            if not target.is_relative_to(root) or not target.is_file() or target.suffix.lower() not in _STATIC_TYPES:
                raise ValueError("unsupported static asset")
            with target.open("rb") as stream:
                raw = stream.read(_MAX_STATIC_BYTES + 1)
            if len(raw) > _MAX_STATIC_BYTES:
                raise ApiError("RESPONSE_LIMIT", "The static resource exceeds the Web budget.", 413)
        except (OSError, ValueError, RuntimeError):
            raise ApiError("ROUTE_NOT_FOUND", "The static resource does not exist.", 404) from None
        self._headers(200, _STATIC_TYPES[target.suffix.lower()], len(raw))
        self.wfile.write(raw)

    def do_GET(self):
        try:
            path, query = self._request_boundary()
            if path.startswith("/api/") or path == "/api":
                self._json(200, envelope(self._api(path, query)))
            else:
                self._static(path, query)
        except ApiError as error:
            self._json(error.status, {"error": {"code": error.code, "message": error.message}})
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            self.close_connection = True
        except Exception:
            self._json(500, {"error": {"code": "INSPECTION_UNAVAILABLE", "message": "Safe read-only inspection is unavailable."}})

    def _unsupported_method(self):
        self.close_connection = True
        self._json(405, {"error": {"code": "READ_ONLY", "message": "Only GET requests are supported."}})

    do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = _unsupported_method


def main(argv=None):
    parser = argparse.ArgumentParser(description="Axis-Evo read-only local Web Workbench")
    parser.add_argument("--config", type=Path, help="Explicit local project JSON; never publish credentials")
    parser.add_argument("--runtime-config", type=Path, help="Explicit opt-in runtime configuration; backend credential references only")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--web-root", type=Path, default=Path("web/dist"), help="Built frontend assets only")
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    try:
        config = WorkbenchConfig.from_file(args.config) if args.config else WorkbenchConfig()
        root = args.web_root if args.web_root.is_dir() else None
        if args.runtime_config:
            from .runtime_config import RuntimeConfig
            from .provider_store import ProviderStore
            from .runtime_service import RuntimeService
            from .runtime_http import RuntimeServer
            runtime_config = RuntimeConfig.from_file(args.runtime_config, config)
            runtime = RuntimeService(runtime_config, config, ProviderStore(runtime_config))
            server = RuntimeServer(("127.0.0.1", args.port), ReadFacade(config), runtime, web_root=root)
        else:
            server = WorkbenchServer(("127.0.0.1", args.port), ReadFacade(config), web_root=root)
    except (ApiError, OSError, ValueError):
        parser.error("The explicit local configuration, frontend or loopback port is unavailable")
    print(f"Axis-Evo read-only bridge: {server.origin}; configured projects: {len(config.projects)}")
    if args.runtime_config:
        print("Runtime explicitly enabled. Enter this one-use local session code in Runtime permissions:",
              server.sessions.bootstrap_code)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
