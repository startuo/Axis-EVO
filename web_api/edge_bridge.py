"""Edge-only automatic loopback transport. A command is dispatched at most once.

The extension keeps login state. This bridge never reads a browser profile,
credentials, cookies or remote debugging port. Browser identity is a checked
client declaration, not attestation against another process of the same OS user.
"""
from collections import deque
from copy import deepcopy
import base64
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import socket
import threading
import time
from uuid import uuid4

from .browser_store import canonical, digest
from .schemas import ApiError, strict_json

PROTOCOL = 2
PORT = 8767
READ_ACTIONS = frozenset(('tabs', 'bind', 'snapshot', 'read', 'screenshot', 'focus'))
WRITE_ACTIONS = frozenset(('click', 'type', 'select', 'scroll'))
INSTANCE = re.compile(r'edge_[a-f0-9]{32}\Z')
_MANIFEST = json.loads((Path(__file__).resolve().parent.parent / 'browser/edge-extension/manifest.json').read_text(encoding='utf-8'))
_PUBLIC_KEY = base64.b64decode(_MANIFEST['key'], validate=True)
EXTENSION_ID = ''.join(chr(97 + digit) for value in hashlib.sha256(_PUBLIC_KEY).digest()[:16]
                       for digit in (value >> 4, value & 15))
EXTENSION_ORIGIN = 'chrome-extension://' + EXTENSION_ID


class _LoopbackServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR permits multiple live listeners on the same port.
    # Match the workbench listener's exclusive ownership, before binding.
    allow_reuse_address = not hasattr(socket, 'SO_EXCLUSIVEADDRUSE')

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def reject(code, message, status=409):
    raise ApiError(code, message, status)


class EdgeBridge:
    def __init__(self, store, *, port=PORT, clock=time.monotonic, timeout=25):
        self.store, self.port, self.clock, self.timeout = store, port, clock, timeout
        self._condition = threading.Condition(threading.RLock())
        self._sessions, self._pending, self._queues, self._bindings = {}, {}, {}, {}
        self._server = self._thread = None
        self._closed = False

    def start(self):
        with self._condition:
            if self._closed:
                reject('EDGE_BRIDGE_CLOSED', '本地浏览器桥已关闭。', 503)
            if self._server is None:
                bridge = self

                class Handler(BaseHTTPRequestHandler):
                    server_version = 'AxisEdgeBridge/1'

                    def log_message(self, *_):
                        pass

                    def do_OPTIONS(self):
                        origin = self.headers.get('Origin', '')
                        if (self.headers.get_all('Host', []) != [f'127.0.0.1:{bridge.port}']
                                or origin != EXTENSION_ORIGIN
                                or self.headers.get('Access-Control-Request-Method') != 'POST'):
                            self.respond(403, {'error': {'code': 'EDGE_ORIGIN_REJECTED', 'message': '网页不能访问浏览器桥。'}}, '')
                            return
                        self.send_response(204)
                        self.send_header('Access-Control-Allow-Origin', origin)
                        self.send_header('Access-Control-Allow-Methods', 'POST')
                        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Axis-Connection')
                        self.send_header('Cache-Control', 'no-store')
                        self.send_header('Content-Length', '0')
                        self.end_headers()

                    def do_POST(self):
                        origin = self.headers.get('Origin', '')
                        try:
                            if self.headers.get_all('Host', []) != [f'127.0.0.1:{bridge.port}']:
                                reject('EDGE_HOST_REJECTED', '只接受精确本机地址。', 403)
                            if origin != EXTENSION_ORIGIN or not re.search(r'\bEdg/\d+', self.headers.get('User-Agent', '')):
                                reject('EDGE_ORIGIN_REJECTED', '网页不能访问浏览器桥。', 403)
                            lengths = self.headers.get_all('Content-Length', [])
                            if (self.headers.get_all('Transfer-Encoding', []) or len(lengths) != 1
                                    or not lengths[0].isascii() or not lengths[0].isdecimal()
                                    or not 0 < int(lengths[0]) <= 524288
                                    or self.headers.get_all('Content-Type', []) != ['application/json']):
                                reject('EDGE_BODY_REJECTED', '需要有界 JSON 请求。', 400)
                            self.connection.settimeout(20)
                            raw = self.rfile.read(int(lengths[0]))
                            if len(raw) != int(lengths[0]):
                                reject('EDGE_BODY_REJECTED', '请求未完整收到。', 400)
                            body = strict_json(raw, limit=524288)
                            if type(body) is not dict:
                                reject('EDGE_BODY_REJECTED', '需要 JSON 对象。', 400)
                            if self.path == '/connect':
                                value = bridge.connect(body, self.headers.get('User-Agent', ''), origin)
                            else:
                                connection = self.headers.get('X-Axis-Connection', '')
                                if self.path == '/poll':
                                    value = bridge.poll(body, connection, origin)
                                elif self.path == '/result':
                                    value = bridge.receipt(body, connection, origin)
                                elif self.path == '/disconnect':
                                    value = bridge.disconnect(body, connection, origin)
                                else:
                                    reject('EDGE_ROUTE_NOT_FOUND', '浏览器桥没有该操作。', 404)
                            self.respond(200, value, origin)
                        except ApiError as error:
                            self.respond(error.status, {'error': {'code': error.code, 'message': error.message}}, origin)
                        except (ValueError, UnicodeError, TypeError, RecursionError):
                            self.respond(400, {'error': {'code': 'EDGE_BODY_REJECTED', 'message': '浏览器请求格式不正确。'}}, origin)
                        except (OSError, TimeoutError):
                            self.close_connection = True
                        except Exception:
                            self.respond(500, {'error': {'code': 'EDGE_BRIDGE_ERROR', 'message': '操作未确认；不会重派。'}}, origin)

                    def respond(self, status, value, origin):
                        raw = canonical(value).encode('utf-8')
                        self.send_response(status)
                        self.send_header('Content-Type', 'application/json; charset=utf-8')
                        self.send_header('Content-Length', str(len(raw)))
                        self.send_header('Cache-Control', 'no-store')
                        self.send_header('X-Content-Type-Options', 'nosniff')
                        if origin == EXTENSION_ORIGIN:
                            self.send_header('Access-Control-Allow-Origin', origin)
                        self.end_headers()
                        self.wfile.write(raw)

                server = _LoopbackServer(('127.0.0.1', self.port), Handler)
                server.daemon_threads = True
                self.port = server.server_address[1]
                self._server = server
                self._thread = threading.Thread(target=server.serve_forever, name='axis-edge-bridge', daemon=True)
                self._thread.start()
        return self.status()

    def connect(self, body, user_agent, origin=''):
        if (body.keys() != {'instanceId', 'extensionId', 'label', 'protocol'}
                or not INSTANCE.fullmatch(str(body.get('instanceId', '')))
                or body.get('extensionId') != EXTENSION_ID
                or body.get('protocol') != PROTOCOL or type(body.get('protocol')) is not int
                or type(body.get('label')) is not str or not 1 <= len(body['label']) <= 48
                or not re.search(r'\bEdg/\d+', user_agent)
                or origin and origin != EXTENSION_ORIGIN):
            reject('EDGE_IDENTITY_REJECTED', '请使用 Microsoft Edge 中的 Axis 扩展连接。', 403)
        with self._condition:
            instance = body['instanceId']
            existing = self._sessions.get(instance)
            connection = existing['connectionId'] if existing else uuid4().hex
            self._sessions[instance] = {'connectionId': connection, 'extensionId': body['extensionId'],
                'label': body['label'], 'lastSeen': self.clock(), 'version': re.search(r'Edg/([\d.]+)', user_agent)[1]}
            self._queues.setdefault(instance, deque())
            self._condition.notify_all()
            return {'instanceId': instance, 'connectionId': connection, 'protocol': PROTOCOL, 'browser': 'Microsoft Edge'}

    def _session(self, instance, connection, origin):
        session = self._sessions.get(instance)
        if (not session or connection != session['connectionId']
                or origin and origin != EXTENSION_ORIGIN):
            reject('EDGE_SESSION_REQUIRED', '扩展正在重新连接本地工作台。', 403)
        session['lastSeen'] = self.clock()
        return session

    def poll(self, body, connection, origin=''):
        if body.keys() != {'instanceId'}:
            reject('EDGE_REQUEST_REJECTED', '轮询请求不正确。', 400)
        instance = body['instanceId']
        with self._condition:
            self._session(instance, connection, origin)
            deadline = self.clock() + 12
            while not self._closed and not self._queues.get(instance) and self.clock() < deadline:
                self._condition.wait(min(1, max(0, deadline - self.clock())))
                self._session(instance, connection, origin)
            while self._queues.get(instance):
                operation = self._queues[instance].popleft()
                pending = self._pending.get(operation)
                if pending is None:
                    continue
                # Commit dispatch before returning bytes; a lost HTTP response is UNKNOWN.
                self.store.fact(operation, 'DISPATCHED', {'instanceId': instance})
                pending['dispatched'] = True
                return {'command': pending['command']}
            return {'command': None}

    def receipt(self, body, connection, origin=''):
        if body.keys() != {'instanceId', 'operationId', 'ok', 'data', 'error'} or type(body.get('ok')) is not bool:
            reject('EDGE_RECEIPT_REJECTED', '浏览器回执格式不正确。', 400)
        with self._condition:
            self._session(body['instanceId'], connection, origin)
            record = self.store.get(body['operationId'])
            if record['instanceId'] != body['instanceId'] or not any(f['kind'] == 'DISPATCHED' for f in record['facts']):
                reject('EDGE_RECEIPT_REJECTED', '回执不属于当前实例的已派发操作。', 403)
            payload = {'ok': body['ok'], 'data': body['data'], 'error': body['error'], 'source': 'EDGE_EXTENSION_RECEIPT'}
            if record['state'] == 'UNKNOWN':
                self.store.fact(body['operationId'], 'LATE_RESULT', payload)
            else:
                uncertain = isinstance(body['data'], dict) and body['data'].get('outcomeUnknown') is True
                self.store.fact(body['operationId'], 'UNKNOWN' if uncertain else 'RESULT', payload)
            pending = self._pending.get(body['operationId'])
            if pending:
                pending['result'] = payload
            self._condition.notify_all()
            return {'recorded': True, 'originalOutcomePreserved': record['state'] == 'UNKNOWN'}

    def _lose_instance(self, instance, reason):
        self._sessions.pop(instance, None)
        for operation, pending in list(self._pending.items()):
            if pending['instance'] == instance and not pending.get('result') and not pending.get('lost'):
                self.store.fact(operation, 'UNKNOWN' if pending['dispatched'] else 'REJECTED', {'code': reason})
                pending['lost'] = True
        for binding in self._bindings.values():
            if binding['instanceId'] == instance:
                binding['active'] = False
        self._queues.pop(instance, None)

    def disconnect(self, body, connection, origin=''):
        if body.keys() != {'instanceId'}:
            reject('EDGE_REQUEST_REJECTED', '断开请求不正确。', 400)
        with self._condition:
            self._session(body['instanceId'], connection, origin)
            self._lose_instance(body['instanceId'], 'EDGE_DISCONNECTED')
            self._condition.notify_all()
        return {'disconnected': True}

    def command(self, instance, action, params=None, *, binding=None, approval=None):
        if action not in READ_ACTIONS | WRITE_ACTIONS or type(params or {}) is not dict:
            reject('EDGE_ACTION_REJECTED', '该浏览器工具未开放。', 403)
        with self._condition:
            session = self._sessions.get(instance)
            if not session or self.clock() - session['lastSeen'] > 35:
                reject('EDGE_OFFLINE', '指定的 Edge 实例未连接；请重新连接。', 503)
            target = None
            if action not in ('tabs', 'bind'):
                target = self._bindings.get(binding)
                if not target or not target['active'] or target['instanceId'] != instance:
                    reject('EDGE_BINDING_REQUIRED', '请明确选择 Edge 实例与标签页。', 403)
            request = deepcopy({'action': action, 'params': params or {}, 'binding': target})
            if action in WRITE_ACTIONS and approval != digest(request):
                reject('EDGE_APPROVAL_REQUIRED', '需要批准当前快照上的精确操作。', 403)
            if action in WRITE_ACTIONS:
                request['authorization'] = {'source': 'USER_EXACT_APPROVAL', 'sha256': approval}
            operation = self.store.create(instance, binding, action, request)
            command = {'id': operation, **request}
            pending = {'instance': instance, 'command': command, 'dispatched': False}
            self._pending[operation] = pending
            self._queues.setdefault(instance, deque()).append(operation)
            self._condition.notify_all()
            deadline = self.clock() + self.timeout
            try:
                while not pending.get('result') and not pending.get('lost') and self.clock() < deadline and not self._closed:
                    self._condition.wait(min(1, max(0, deadline - self.clock())))
                if not pending.get('result') and not pending.get('lost'):
                    self.store.fact(operation, 'UNKNOWN' if pending['dispatched'] else 'REJECTED',
                                    {'code': 'EDGE_RESPONSE_NOT_CONFIRMED' if pending['dispatched'] else 'EDGE_NOT_DISPATCHED'})
                return self.store.get(operation)
            finally:
                self._pending.pop(operation, None)

    def bind(self, instance, tab_id):
        if type(tab_id) is not int or tab_id < 0:
            reject('EDGE_TAB_REJECTED', '标签页身份不正确。', 400)
        record = self.command(instance, 'bind', {'tabId': tab_id})
        receipt = record['result']
        if record['state'] != 'RESULT' or not receipt.get('ok'):
            return {'operation': record, 'binding': None}
        data = receipt['data']
        if (type(data) is not dict or data.get('tabId') != tab_id or type(data.get('documentId')) is not str
                or not re.fullmatch(r'[a-f0-9]{64}', str(data.get('urlSha256', '')))):
            reject('EDGE_BINDING_REJECTED', '标签页回执缺少文档身份。', 409)
        binding = {'id': 'edgebind_' + uuid4().hex, 'instanceId': instance, 'tabId': tab_id,
                   'windowId': data.get('windowId'), 'documentId': data['documentId'], 'urlSha256': data['urlSha256'],
                   'url': str(data.get('url', ''))[:1024], 'title': str(data.get('title', ''))[:200],
                   'snapshotId': None, 'active': True}
        with self._condition:
            self._bindings[binding['id']] = binding
        return {'operation': record, 'binding': dict(binding)}

    def status(self):
        with self._condition:
            return {'running': self._server is not None and not self._closed, 'port': self.port,
                'instances': [{'id': key, 'label': s['label'], 'browser': 'Microsoft Edge', 'version': s['version'],
                    'extensionId': s['extensionId'], 'connected': self.clock() - s['lastSeen'] <= 35}
                    for key, s in self._sessions.items()], 'bindings': [dict(b) for b in self._bindings.values()]}

    def close(self):
        with self._condition:
            self._closed = True
            for instance in list(self._sessions):
                self._lose_instance(instance, 'EDGE_BRIDGE_CLOSED')
            self._condition.notify_all()
        if self._server:
            self._server.shutdown()
            self._server.server_close()
