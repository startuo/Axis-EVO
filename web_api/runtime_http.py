"""Session-authorized opt-in mutations; the original read-only server is unchanged."""
import json
import socket
import time

from .app import WorkbenchHandler, WorkbenchServer
from .runtime_auth import RuntimeSessions, SESSION_COOKIE, SESSION_TTL_SECONDS
from .schemas import ApiError, strict_json


def runtime_envelope(data):
    return {"schema_version": 1, "mode": "runtime", "data": data}


class RuntimeServer(WorkbenchServer):
    def __init__(self, address, facade, runtime, *, web_root=None, allowed_origins=(), sessions=None):
        self.runtime = runtime
        from .runtime_conversations import ConversationService
        self.conversations = ConversationService(runtime)
        from .evolution_service import EvolutionService
        self.evolution = EvolutionService(runtime)
        self.sessions = sessions or RuntimeSessions()
        super().__init__(address, facade, web_root=web_root, allowed_origins=allowed_origins)
        self.RequestHandlerClass = RuntimeHandler

    def server_close(self):
        if hasattr(self, 'evolution'):
            self.evolution.close()
        super().server_close()
        if hasattr(self, "runtime"):
            self.runtime.close(wait=False)


class RuntimeHandler(WorkbenchHandler):
    server_version = "AxisEvoWorkbench/2"

    def _origin(self, *, mutation=False):
        origins = self.headers.get_all("Origin", [])
        host_origin = "http://" + self.headers["Host"]
        if mutation and len(origins) != 1:
            raise ApiError("ORIGIN_REQUIRED", "Mutations require an exact first-party Origin.", 403)
        origin = origins[0] if origins else host_origin
        if origin != host_origin:
            raise ApiError("ORIGIN_REJECTED", "The session Origin must match the request Host.", 403)
        return origin

    def _cookie(self):
        values = self.headers.get_all("Cookie", [])
        if len(values) > 1:
            raise ApiError("SESSION_REQUIRED", "A first-party local session is required.", 403)
        return values[0] if values else ""

    def _authenticated(self, *, mutation=False):
        tokens = self.headers.get_all("X-Axis-CSRF", [])
        if len(tokens) > 1:
            raise ApiError("CSRF_REJECTED", "The CSRF token is invalid.", 403)
        self.server.sessions.verify(self._cookie(), tokens[0] if tokens else None,
                                    self._origin(mutation=mutation), mutation=mutation)

    def _body(self):
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get_all("Transfer-Encoding", []) or len(lengths) != 1:
            raise ApiError("INVALID_BODY", "A single bounded JSON Content-Length is required.")
        if self.headers.get_all("Content-Type", []) != ["application/json"]:
            raise ApiError("INVALID_BODY", "Only application/json is accepted.", 415)
        length = lengths[0]
        if not length.isascii() or not length.isdecimal() or len(length) > 6 or not 1 <= int(length) <= 65536:
            raise ApiError("REQUEST_LIMIT", "The mutation body exceeds the 64 KiB limit.", 413)
        raw = self.rfile.read(int(length))
        self._body_consumed = True
        if len(raw) != int(length):
            raise ApiError("INVALID_BODY", "The JSON body is incomplete.")
        try:
            body = strict_json(raw)
            if type(body) is not dict:
                raise ValueError("object required")
            return body
        except (ValueError, TypeError, UnicodeError, RecursionError):
            raise ApiError("INVALID_BODY", "The JSON body is malformed or ambiguous.") from None

    def _drain_rejected_body(self):
        """Preserve an HTTP error response when Windows would reset unread TCP.

        This consumes bytes only, never parses or authorizes a rejected action.
        Unknown/oversized framing is drained within a short budget, never parsed;
        normal declared bodies retain the
        same 64 KiB and five-second socket bounds as accepted requests.
        """
        if getattr(self, "_body_consumed", False):
            return
        lengths = self.headers.get_all("Content-Length", [])
        declared = (len(lengths) == 1 and lengths[0].isascii() and lengths[0].isdecimal()
                    and len(lengths[0]) <= 6)
        if (self.headers.get_all('Transfer-Encoding', []) or not declared
                or int(lengths[0]) > 65536):
            # Reject oversized framing without waiting for the advertised body.
            # Consume at most already-arriving bounded bytes so Windows can send
            # the error response without resetting a small malformed request.
            previous = self.connection.gettimeout()
            try:
                deadline = time.monotonic() + 0.05
                remaining = 65536
                while remaining:
                    budget = deadline - time.monotonic()
                    if budget <= 0:
                        break
                    self.connection.settimeout(budget)
                    data = self.rfile.read1(min(4096, remaining))
                    if not data:
                        break
                    remaining -= len(data)
            except (OSError, socket.timeout):
                pass
            finally:
                self.connection.settimeout(previous)
            return
        try:
            self.rfile.read(int(lengths[0]))
            self._body_consumed = True
        except (OSError, socket.timeout):
            pass

    def _runtime_read(self, path):
        runtime = self.server.runtime
        if path == "/api/runtime/capabilities":
            authenticated = False
            try:
                self._authenticated()
                authenticated = True
            except ApiError:
                pass
            return runtime.capabilities(authenticated)
        if path == "/api/runtime/session":
            return {"csrfToken": self.server.sessions.resume(self._cookie(), self._origin())}
        self._authenticated()
        parts = path.strip("/").split("/")
        if parts == ["api", "runtime", "providers"]:
            return runtime.providers.list()
        if len(parts) == 5 and parts[:3] == ['api', 'runtime', 'providers'] and parts[4] == 'history':
            return runtime.providers.history(parts[3])
        if len(parts) >= 6 and parts[:3] == ['api', 'runtime', 'projects'] and parts[4] == 'skill-evolution':
            evolution, tail = self.server.evolution, parts[5:]
            if tail == ['library']:
                return evolution.library(parts[3])
            if tail == ['research']:
                return evolution.research_readiness(parts[3])
            if len(tail) == 3 and tail[0] == 'evidence' and tail[2].isascii() and tail[2].isdecimal() and len(tail[2]) < 8:
                return evolution.preview(parts[3], {'skill_id': tail[1], 'skill_version': int(tail[2])})
            if tail == ['cases']:
                return evolution.list_cases(parts[3])
            if len(tail) == 2 and tail[0] == 'cases':
                return evolution.report(parts[3], tail[1])
            if len(tail) == 2 and tail[0] == 'generations':
                return evolution.generation(parts[3], tail[1])
        if len(parts) >= 5 and parts[:3] == ["api", "runtime", "projects"] and parts[4] == "threads":
            if len(parts) == 5:
                return runtime.list_threads(parts[3])
            if len(parts) == 6:
                return runtime.get_thread(parts[3], parts[5])
        if len(parts) >= 5 and parts[:3] == ['api', 'runtime', 'projects'] and parts[4] == 'conversations':
            conversations = self.server.conversations
            if len(parts) == 5:
                return conversations.list(parts[3])
            if len(parts) == 6:
                return conversations.get(parts[3], parts[5])
            if len(parts) == 8 and parts[6] == 'turns':
                return conversations.get_turn(parts[3], parts[5], parts[7])
            if len(parts) == 9 and parts[6] == 'turns' and parts[8] == 'context':
                return conversations.context(parts[3], parts[5], parts[7])
        raise ApiError("ROUTE_NOT_FOUND", "The runtime route does not exist.", 404)

    def do_GET(self):
        if not self.path.startswith("/api/runtime/"):
            return super().do_GET()
        try:
            path, query = self._request_boundary()
            self._query(query, set())
            self._json(200, runtime_envelope(self._runtime_read(path)))
        except ApiError as error:
            self._json(error.status, {"error": {"code": error.code, "message": error.message}})
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            self.close_connection = True
        except Exception:
            self._json(500, {"error": {"code": "RUNTIME_UNAVAILABLE", "message": "Runtime facts are unavailable."}})

    def do_POST(self):
        self._body_consumed = False
        self.close_connection = True
        try:
            path, query = self._request_boundary()
            self._query(query, set())
            if not path.startswith("/api/runtime/"):
                return self._unsupported_method()
            origin = self._origin(mutation=True)
            if path == "/api/runtime/session":
                body = self._body()
                if body.keys() != {"code"}:
                    raise ApiError("INVALID_SESSION", "Only the local bootstrap code is accepted.")
                session, csrf = self.server.sessions.create(body["code"], origin)
                # Secure requires HTTPS; this explicitly loopback HTTP listener
                # uses HttpOnly/SameSite and never claims transport encryption.
                self.send_response(200)
                raw = json.dumps(runtime_envelope({"csrfToken": csrf})).encode("utf-8")
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Set-Cookie", f"{SESSION_COOKIE}={session}; Path=/api/runtime; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL_SECONDS}")
                self.end_headers()
                self.wfile.write(raw)
                return
            self._authenticated(mutation=True)
            body = self._body()
            runtime, parts = self.server.runtime, path.strip("/").split("/")
            status = 200
            if parts == ["api", "runtime", "providers"]:
                result = runtime.providers.create(body)
                status = 201
            elif (len(parts) == 7 and parts[:3] == ['api', 'runtime', 'providers']
                    and parts[4] == 'revisions' and parts[6] == 'models' and body == {}
                    and parts[5].isascii() and parts[5].isdecimal() and len(parts[5]) < 8):
                result = runtime.providers.discover_models(parts[3], int(parts[5]))
            elif len(parts) == 5 and parts[:3] == ["api", "runtime", "providers"] and parts[4] == "revisions":
                result = runtime.providers.edit(parts[3], body)
                status = 201
            elif len(parts) == 5 and parts[:3] == ["api", "runtime", "providers"] and parts[4] == "activate" and body == {}:
                result = runtime.providers.activate(parts[3])
            elif (len(parts) == 7 and parts[:3] == ["api", "runtime", "providers"]
                    and parts[4] == "revisions" and parts[6] == "test" and body == {}
                    and parts[5].isascii() and parts[5].isdecimal() and len(parts[5]) < 8):
                result = runtime.providers.test(parts[3], int(parts[5]))
            elif len(parts) >= 6 and parts[:3] == ['api', 'runtime', 'projects'] and parts[4] == 'skill-evolution':
                evolution, tail = self.server.evolution, parts[5:]
                if tail == ['cases']:
                    result = evolution.create_case(parts[3], body)
                elif tail == ['trace-cases']:
                    result = evolution.create_trace_case(parts[3], body)
                elif len(tail) == 3 and tail[0] == 'cases' and tail[2] == 'generate' and body == {}:
                    result = evolution.request_generation(parts[3], tail[1])
                elif len(tail) == 3 and tail[0] == 'generations' and tail[2] == 'drafts':
                    result = evolution.edit_draft(parts[3], tail[1], body)
                elif len(tail) == 3 and tail[0] == 'generations' and tail[2] == 'reject':
                    result = evolution.reject_suggestion(parts[3], tail[1], body)
                elif len(tail) == 3 and tail[0] == 'drafts' and tail[2] == 'prepare' and body == {}:
                    result = evolution.prepare_candidate(parts[3], tail[1])
                elif len(tail) == 3 and tail[0] == 'drafts' and tail[2] == 'prepare-trace' and body == {}:
                    result = evolution.prepare_trace_candidate(parts[3], tail[1])
                elif len(tail) == 3 and tail[0] == 'trace-candidates' and tail[2] == 'approve':
                    result = evolution.approve_trace_candidate(parts[3], tail[1], body)
                elif len(tail) == 3 and tail[0] == 'revisions' and tail[2] == 'approve':
                    result = evolution.approve_candidate(parts[3], tail[1], body)
                elif len(tail) == 3 and tail[0] == 'cases' and tail[2] == 'evaluate':
                    result = evolution.request_evaluation(parts[3], tail[1], body)
                elif len(tail) == 4 and tail[0] == 'cases' and tail[2] == 'actions':
                    result = evolution.action(parts[3], tail[1], tail[3], body)
                else:
                    raise ApiError('ROUTE_NOT_FOUND', 'The evolution operation does not exist.', 404)
                status = 202
            elif len(parts) >= 5 and parts[:3] == ["api", "runtime", "projects"] and parts[4] == "threads":
                if len(parts) == 5:
                    result = runtime.create_thread(parts[3], body)
                    status = 202
                elif len(parts) == 7 and parts[6] == "approve":
                    result = runtime.approve(parts[3], parts[5], body)
                    status = 202
                else:
                    raise ApiError("ROUTE_NOT_FOUND", "The mutation route does not exist.", 404)
            elif len(parts) >= 5 and parts[:3] == ['api', 'runtime', 'projects'] and parts[4] == 'conversations':
                conversations = self.server.conversations
                if len(parts) == 5:
                    result = conversations.start(parts[3], body)
                elif len(parts) == 7 and parts[6] == 'turns':
                    result = conversations.append(parts[3], parts[5], body)
                elif len(parts) == 9 and parts[6] == 'turns' and parts[8] == 'approve':
                    result = conversations.approve(parts[3], parts[5], parts[7], body)
                else:
                    raise ApiError('ROUTE_NOT_FOUND', 'The conversation route does not exist.', 404)
                status = 202
            else:
                raise ApiError("ROUTE_NOT_FOUND", "The mutation route does not exist.", 404)
            self._json(status, runtime_envelope(result))
        except ApiError as error:
            self._drain_rejected_body()
            self._json(error.status, {"error": {"code": error.code, "message": error.message}})
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            self.close_connection = True
        except Exception:
            self._json(500, {"error": {"code": "RUNTIME_REJECTED", "message": "The runtime operation was not completed."}})
