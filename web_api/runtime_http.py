"""Session-authorized opt-in mutations; the original read-only server is unchanged."""
import json
import socket
import threading
import time

from .app import WorkbenchHandler, WorkbenchServer
from .runtime_auth import RuntimeSessions, SESSION_COOKIE, SESSION_TTL_SECONDS
from .schemas import ApiError, strict_json


def runtime_envelope(data):
    return {"schema_version": 1, "mode": "runtime", "data": data}


class RuntimeServer(WorkbenchServer):
    request_queue_size = 32

    def __init__(self, address, facade, runtime, *, web_root=None, allowed_origins=(), sessions=None,
                 bound_socket=None, credential_manager=None, legacy_runtime=False):
        self.runtime = runtime
        self.credential_manager = credential_manager
        self.sessions = sessions or RuntimeSessions()
        self._read_slots = threading.BoundedSemaphore(8)
        self._write_slots = threading.BoundedSemaphore(4)
        self._legacy_lock = threading.RLock()
        self._legacy_closed = False
        self._replies = self._workspace = None
        super().__init__(address, facade, web_root=web_root, allowed_origins=allowed_origins,
                         bound_socket=bound_socket, connection_slots=16)
        try:
            from .runtime_conversations import ConversationService
            self.conversations = ConversationService(runtime)
            from .evolution_service import EvolutionService
            self.evolution = EvolutionService(runtime)
            from .task_feedback import FeedbackService
            self.feedback = FeedbackService(runtime, self.evolution)
            from .browser_service import BrowserService
            self.browser = BrowserService(runtime)
            from .agent_service import AgentService
            self.agent = AgentService(runtime, self.browser)
            if legacy_runtime:
                self._load_workspace()
            self.RequestHandlerClass = RuntimeHandler
        except BaseException:
            self.server_close()
            raise

    @property
    def replies(self):
        with self._legacy_lock:
            if self._legacy_closed:
                raise ApiError('RUNTIME_CLOSED', '应用正在关闭。', 503)
            if self._replies is None:
                from .conversation_replies import ReplyService
                self._replies = ReplyService(self.runtime)
            return self._replies

    def _load_workspace(self):
        with self._legacy_lock:
            if self._legacy_closed:
                raise ApiError('RUNTIME_CLOSED', '应用正在关闭。', 503)
            if self._workspace is None:
                from .collaboration_service import CollaborationService
                self._workspace = CollaborationService(self.runtime, self.replies, self.browser)
            return self._workspace

    @property
    def workspace(self):
        return self._load_workspace()

    def server_close(self):
        try:
            if hasattr(self, 'agent'):
                self.agent.close()
            with self._legacy_lock:
                self._legacy_closed = True
                if self._workspace is not None:
                    self._workspace.close()
                if self._replies is not None:
                    self._replies.close(wait=False)
            if hasattr(self, 'browser'):
                self.browser.close()
            if hasattr(self, 'evolution'):
                self.evolution.close()
            super().server_close()
            if hasattr(self, "runtime"):
                self.runtime.close(wait=False)
        finally:
            if getattr(self,'credential_manager',None) is not None:
                self.credential_manager.close()


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

    @staticmethod
    def _agent_tail(path):
        for prefix in ('/api/runtime/agent/', '/api/agent/'):
            if path.startswith(prefix):
                return path[len(prefix):].split('/')
        return None

    def _body(self, maximum=65536):
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get_all("Transfer-Encoding", []) or len(lengths) != 1:
            raise ApiError("INVALID_BODY", "A single bounded JSON Content-Length is required.")
        if self.headers.get_all("Content-Type", []) != ["application/json"]:
            raise ApiError("INVALID_BODY", "Only application/json is accepted.", 415)
        length = lengths[0]
        if (not length.isascii() or not length.isdecimal() or len(length) > len(str(maximum))
                or not 1 <= int(length) <= maximum):
            raise ApiError("REQUEST_LIMIT", "The mutation body exceeds the route limit.", 413)
        raw = self.rfile.read(int(length))
        self._body_consumed = True
        if len(raw) != int(length):
            raise ApiError("INVALID_BODY", "The JSON body is incomplete.")
        try:
            body = strict_json(raw, maximum)
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

    def _runtime_read(self, path, query=''):
        runtime = self.server.runtime
        tail = self._agent_tail(path)
        if tail is not None:
            from .agent_http import read
            self._authenticated()
            return read(self.server.agent, tail, query)
        self._query(query, set())
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
        if path == '/api/runtime/browser/status':
            return self.server.browser.status()
        if path.startswith('/api/runtime/browser/operations/'):
            self.server.browser.require()
            return self.server.browser.store.get(path.rsplit('/', 1)[1])
        parts = path.strip("/").split("/")
        if len(parts) >= 7 and parts[:3] == ['api','runtime','projects']:
            if parts[4:6] == ['workspace','drafts']:
                if len(parts) == 7:
                    return self.server.workspace.get(parts[3], parts[6])
                if len(parts) == 8 and parts[7] == 'evidence':
                    return self.server.workspace.evidence(parts[3], parts[6])
            if len(parts) == 7 and parts[4] == 'conversations' and parts[6] == 'workspace-drafts':
                return self.server.workspace.list(parts[3], parts[5])
        if len(parts) == 7 and parts[:3] == ['api', 'runtime', 'projects'] and parts[4] == 'threads' and parts[6] == 'feedback':
            return self.server.feedback.list(parts[3], parts[5])
        if len(parts) == 6 and parts[:3] == ['api', 'runtime', 'projects'] and parts[4] == 'feedback':
            return self.server.feedback.get(parts[3], parts[5])
        if parts == ["api", "runtime", "providers"]:
            value=runtime.providers.list()
            if self.server.credential_manager is not None:
                value['credentialEnrollment']=self.server.credential_manager.describe()
            return value
        if len(parts) == 4 and parts[:3] == ['api', 'runtime', 'providers']:
            return runtime.providers.get(parts[3])
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
            if len(parts) == 8 and parts[6] == 'invocations':
                return runtime.invocation(parts[3], parts[5], parts[7])
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
        if len(parts) == 6 and parts[:3] == ['api','runtime','projects'] and parts[4] == 'replies':
            return self.server.replies.get(parts[3], parts[5])
        raise ApiError("ROUTE_NOT_FOUND", "The runtime route does not exist.", 404)

    def _agent_file(self, result):
        from urllib.parse import quote
        self.send_response(200)
        self.send_header('Content-Type', result.media_type)
        self.send_header('Content-Length', str(len(result.data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        is_pdf = result.media_type == 'application/pdf'
        # Native PDF viewers need same-origin embedding. Other content types
        # can run in an opaque sandbox when directly navigated to.
        self.send_header('X-Frame-Options', 'SAMEORIGIN' if is_pdf else 'DENY')
        self.send_header('Content-Security-Policy',
            "default-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'; "
            + ("frame-ancestors 'self'" if is_pdf else "frame-ancestors 'none'; sandbox"))
        if result.download_name is not None:
            self.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + quote(result.download_name,safe=''))
        self.end_headers()
        self.wfile.write(result.data)

    def do_GET(self):
        if not self.path.startswith(('/api/runtime/', '/api/agent/')):
            return super().do_GET()
        try:
            path, query = self._request_boundary()
            if not self.server._read_slots.acquire(timeout=.25):
                raise ApiError('RUNTIME_BUSY', '查询繁忙，请稍后重试。', 503)
            try:
                from .agent_http import AgentFileResponse
                result = self._runtime_read(path, query)
                if isinstance(result, AgentFileResponse):
                    self._agent_file(result)
                else:
                    self._json(200, runtime_envelope(result))
            finally:
                self.server._read_slots.release()
        except ApiError as error:
            self._json(error.status, {"error": {"code": error.code, "message": error.message}})
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            self.close_connection = True
        except Exception:
            self._json(500, {"error": {"code": "RUNTIME_UNAVAILABLE", "message": "Runtime facts are unavailable."}})

    def do_POST(self):
        self._body_consumed = False
        self.close_connection = True
        write_slot = False
        try:
            path, query = self._request_boundary()
            self._query(query, set())
            agent = self._agent_tail(path)
            if not path.startswith("/api/runtime/") and agent is None:
                return self._unsupported_method()
            origin = self._origin(mutation=True)
            session_route = path in ('/api/runtime/session', '/api/runtime/session/launch',
                                     '/api/runtime/session/bootstrap')
            transparent = path == '/api/runtime/session/bootstrap'
            if transparent and self.headers.get_all('X-Axis-Bootstrap', []) != ['1']:
                raise ApiError('ORIGIN_REJECTED', 'First-party session initialization requires its local header.', 403)
            if not session_route:
                self._authenticated(mutation=True)
            patch_route = (agent is not None and len(agent) == 4 and agent[0] == 'workspaces'
                           and agent[2] == 'git' and agent[3] in ('stage', 'unstage', 'revert'))
            if agent == ['turns']:
                from .agent_images import MAX_TURN_BODY_BYTES
                maximum = MAX_TURN_BODY_BYTES
            else:
                maximum = 2_200_000 if patch_route else 65536
            if not self.server._write_slots.acquire(timeout=.25):
                raise ApiError('RUNTIME_BUSY', '操作繁忙，请重新核对当前状态。', 503)
            write_slot = True
            body = self._body(maximum)
            if session_route:
                field = 'capability' if path.endswith('/launch') else 'code'
                if body.keys() != (set() if transparent else {field}):
                    raise ApiError("INVALID_SESSION", "An exact local authorization body is required.")
                had_cookie = SESSION_COOKIE + '=' in self._cookie()
                if transparent:
                    session, csrf = self.server.sessions.initialize(origin)
                else:
                    session, csrf = (self.server.sessions.redeem_launch(body[field], origin) if field == 'capability'
                                     else self.server.sessions.create(body[field], origin))
                # Secure requires HTTPS; this explicitly loopback HTTP listener
                # uses HttpOnly/SameSite and never claims transport encryption.
                self.send_response(200)
                raw = json.dumps(runtime_envelope({"csrfToken": csrf})).encode("utf-8")
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Set-Cookie", f"{SESSION_COOKIE}={session}; Path=/api; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL_SECONDS}")
                if had_cookie:
                    # Clear the previous version's narrower cookie so reads
                    # through /api/runtime cannot pick a stale session value.
                    self.send_header("Set-Cookie", f"{SESSION_COOKIE}=; Path=/api/runtime; HttpOnly; SameSite=Strict; Max-Age=0")
                self.end_headers()
                self.wfile.write(raw)
                return
            runtime, parts = self.server.runtime, path.strip("/").split("/")
            status = 200
            if agent is not None:
                from .agent_http import mutate
                result = mutate(self.server.agent, agent, body)
                status = 202 if agent == ['turns'] else 200
            elif len(parts) >= 6 and parts[:3] == ['api','runtime','projects'] and parts[4:6] == ['workspace','drafts']:
                if len(parts) == 6:
                    conversation = body.pop('conversationId', None)
                    result = self.server.workspace.create(parts[3], body, conversation)
                elif len(parts) == 8 and parts[7] == 'prepare':
                    result = self.server.workspace.prepare(parts[3], parts[6], body)
                elif len(parts) == 8 and parts[7] == 'approve':
                    result = self.server.workspace.approve(parts[3], parts[6], body)
                else:
                    raise ApiError('ROUTE_NOT_FOUND', 'The workspace operation does not exist.', 404)
                status = 202
            elif parts[:3] == ['api', 'runtime', 'browser']:
                browser_routes = {'prepare-storage': self.server.browser.prepare_storage,
                    'connect': self.server.browser.connect, 'tabs': self.server.browser.tabs,
                    'bind': self.server.browser.bind, 'observe': self.server.browser.observe,
                    'prepare-action': self.server.browser.prepare_action, 'approve-action': self.server.browser.approve_action,
                    'handoff': self.server.browser.handoff}
                handler = browser_routes.get(parts[3]) if len(parts) == 4 else None
                if handler is None:
                    raise ApiError('ROUTE_NOT_FOUND', 'The browser operation does not exist.', 404)
                result = handler(body)
            elif len(parts) == 7 and parts[:3] == ['api', 'runtime', 'projects'] and parts[4] == 'threads' and parts[6] == 'feedback':
                result = self.server.feedback.submit(parts[3], parts[5], body)
                status = 201
            elif len(parts) == 7 and parts[:3] == ['api', 'runtime', 'projects'] and parts[4] == 'feedback' and parts[6] == 'revision-proposals':
                result = self.server.feedback.prepare_revision(parts[3], parts[5], body)
                status = 201
            elif len(parts) == 7 and parts[:3] == ['api', 'runtime', 'projects'] and parts[4] == 'feedback-revisions' and parts[6] == 'authorize':
                result = self.server.feedback.authorize_revision(parts[3], parts[5], body)
                status = 201
            elif parts == ['api','runtime','credentials','enroll']:
                if self.server.credential_manager is None:
                    raise ApiError('CREDENTIAL_STORE_UNAVAILABLE','Secure credential enrollment is unavailable.',503)
                result=self.server.credential_manager.enroll(body)
            elif len(parts) == 5 and parts[:3] == ['api','runtime','projects'] and parts[4] == 'replies':
                result = self.server.replies.send(parts[3], body)
                status = 202
            elif len(parts) == 7 and parts[:3] == ['api','runtime','projects'] and parts[4] == 'conversations' and parts[6] == 'replies':
                result = self.server.replies.send(parts[3], body, parts[5])
                status = 202
            elif parts == ["api", "runtime", "providers"]:
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
            elif len(parts) == 5 and parts[:3] == ["api", "runtime", "providers"] and parts[4] in ('archive', 'restore') and body == {}:
                action = runtime.providers.delete if parts[4] == 'archive' else runtime.providers.restore
                result = action(parts[3])
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
                elif len(parts) == 7 and parts[6] == 'artifact-preview':
                    from .runtime_artifacts import preview
                    result = preview(runtime, parts[3], parts[5], body)
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
        finally:
            if write_slot:
                self.server._write_slots.release()
