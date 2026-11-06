"""Workbench authorization and observable Edge operations, above the transport."""
from contextlib import closing
from copy import deepcopy
from pathlib import Path
import re
import threading
import time
from uuid import uuid4

from . import browser_store
from .edge_bridge import EdgeBridge, PROTOCOL, WRITE_ACTIONS, reject
from .schemas import ApiError


class BrowserService:
    def __init__(self, runtime, *, bridge_factory=EdgeBridge):
        self.runtime = runtime
        self.store = browser_store.BrowserStore(runtime.providers)
        with closing(runtime.providers.connect()) as c:
            if getattr(runtime.providers, 'initialize_storage', True):
                browser_store.initialize(c)
            self.prepared = browser_store.available(c)
            if self.prepared:
                browser_store.guard(c)
        self.bridge = bridge_factory(self.store)
        self._lock = threading.RLock()
        self._proposals = {}
        self._busy = set()
        self._connection_error = None
        if self.prepared:
            for operation in self.store.unfinished():
                record = self.store.get(operation)
                self.store.fact(operation, 'UNKNOWN' if record['state'] == 'DISPATCHED' else 'REJECTED',
                                {'code': 'EDGE_COORDINATOR_RESTARTED'})
            try:
                self.bridge.start()
            except OSError:
                self._connection_error = '本地浏览器端口已占用，请关闭重复的 Axis 实例。'

    def require(self):
        if not self.prepared:
            reject('BROWSER_STORAGE_UNPREPARED', '请显式升级本地存储后连接 Edge。', 503)

    def status(self):
        return {'prepared': self.prepared, **self.bridge.status(), 'protocol': PROTOCOL,
                'connectionError': self._connection_error,
                'extensionDirectory': str(Path(__file__).resolve().parent.parent / 'browser' / 'edge-extension'),
                'upstream': {'version': '1.3.0', 'commit': '84d5ee40532ca586650d3d5f78f3952d3061cd06', 'license': 'MIT'},
                'limitations': ['网页不是授权来源', '高风险操作由用户接管', '已派发但未确认的操作不自动重试']}

    def connect(self, body):
        if body != {}:
            reject('EDGE_REQUEST_REJECTED', '连接请求不正确。', 400)
        if not self.prepared:
            self.prepare_storage({})
        try:
            self.bridge.start()
            self._connection_error = None
            return self.status()
        except OSError:
            reject('EDGE_BRIDGE_PORT_OCCUPIED', '本地 8767 端口已占用；请检查已有 Axis 实例。', 503)

    def prepare_storage(self, body):
        if body != {}:
            reject('EDGE_REQUEST_REJECTED', '存储准备请求不正确。', 400)
        with self._lock, closing(self.runtime.providers.connect()) as c:
            browser_store.initialize(c)
            from .collaboration_service import initialize as initialize_workspace
            initialize_workspace(c)
            self.prepared = True
        return self.status()

    def tabs(self, body):
        self.require()
        if type(body) is not dict or body.keys() != {'instanceId'}:
            reject('EDGE_REQUEST_REJECTED', '请明确选择 Edge 实例。', 400)
        return self.bridge.command(body['instanceId'], 'tabs')

    def bind(self, body):
        self.require()
        if type(body) is not dict or body.keys() != {'instanceId', 'tabId'}:
            reject('EDGE_REQUEST_REJECTED', '需要精确标签页身份。', 400)
        return self.bridge.bind(body['instanceId'], body['tabId'])

    def _binding(self, identity):
        binding = self.bridge._bindings.get(identity)
        if not binding or not binding['active']:
            reject('EDGE_BINDING_REQUIRED', '请重新选择并授权标签页。', 403)
        return binding

    def observe(self, body):
        self.require()
        if body.keys() != {'bindingId', 'action'} or body['action'] not in ('snapshot', 'read', 'screenshot', 'focus'):
            reject('EDGE_REQUEST_REJECTED', '观察请求不正确。', 400)
        with self._lock:
            binding = self._binding(body['bindingId'])
            if binding['id'] in self._busy:
                reject('EDGE_OPERATION_PENDING', '此标签页还有未结束操作。', 409)
            self._busy.add(binding['id'])
        try:
            record = self.bridge.command(binding['instanceId'], body['action'], binding=binding['id'])
            self._observe_result(binding, record)
            return {'operation': record, 'binding': dict(binding)}
        finally:
            with self._lock:
                self._busy.discard(binding['id'])

    def _observe_result(self, binding, record):
        if record['state'] == 'UNKNOWN':
            binding['active'] = False
            return
        receipt = record.get('result') or {}
        data = receipt.get('data')
        if not receipt.get('ok'):
            if (receipt.get('error') or {}).get('code') in ('EDGE_TAB_CHANGED', 'EDGE_PROTECTED_PAGE'):
                binding['active'] = False
            return
        if not isinstance(data, dict):
            reject('EDGE_RECEIPT_REJECTED', '缺少页面观察。', 409)
        if record['action'] != 'focus' and any(data.get(key) != binding[key] for key in ('tabId', 'documentId', 'urlSha256')):
            binding['active'] = False
            reject('EDGE_TAB_CHANGED', '页面身份已变化，请重新选择标签页。', 409)
        if 'snapshotId' in data:
            if not re.fullmatch(r's[1-9]\d{0,8}', str(data['snapshotId'])):
                reject('EDGE_SNAPSHOT_REJECTED', '页面快照身份不正确。', 409)
            binding['snapshotId'] = data['snapshotId']
            binding['snapshotSha256'] = browser_store.digest(data.get('snapshot', ''))
            binding['snapshotOperationId'] = record['id']

    def prepare_action(self, body):
        self.require()
        if body.keys() != {'bindingId', 'action', 'params'} or body['action'] not in WRITE_ACTIONS or type(body['params']) is not dict:
            reject('EDGE_ACTION_REJECTED', '浏览器操作未开放。', 403)
        with self._lock:
            binding = self._binding(body['bindingId'])
            if not binding.get('snapshotId') or body['bindingId'] in self._busy:
                reject('EDGE_SNAPSHOT_REQUIRED', '先读取当前页面快照，再提出操作。', 409)
            params = deepcopy(body['params'])
            expected = {'direction'} if body['action'] == 'scroll' else {'ref', 'text'} if body['action'] == 'type' else {'ref', 'value'} if body['action'] == 'select' else {'ref'}
            if params.keys() != expected:
                reject('EDGE_ARGUMENT_REJECTED', '操作参数不正确。', 400)
            if body['action'] != 'scroll' and not re.fullmatch(r'e[1-9]\d{0,3}', str(params.get('ref', ''))):
                reject('EDGE_ARGUMENT_REJECTED', '需要页面快照中的元素引用。', 400)
            if body['action'] == 'scroll' and params['direction'] not in ('up', 'down'):
                reject('EDGE_ARGUMENT_REJECTED', '滚动方向不正确。', 400)
            if body['action'] == 'type' and (type(params['text']) is not str or not 1 <= len(params['text']) <= 2000 or '\n' in params['text'] or '\r' in params['text']):
                reject('EDGE_ARGUMENT_REJECTED', '输入内容需要是有界单行文本。', 400)
            if body['action'] == 'select' and (type(params['value']) is not str or len(params['value']) > 256):
                reject('EDGE_ARGUMENT_REJECTED', '选项值超过限制。', 400)
            params['snapshotId'] = binding['snapshotId']
            request = deepcopy({'action': body['action'], 'params': params, 'binding': binding})
            self.runtime.providers.check_text(browser_store.canonical(request))
            if len(self._proposals) >= 32:
                now = time.monotonic()
                self._proposals = {key: item for key, item in self._proposals.items() if item['expires'] > now}
                if len(self._proposals) >= 32:
                    reject('EDGE_PROPOSAL_LIMIT', '待审操作过多，请先处理当前操作。', 429)
            identity = 'edgeproposal_' + uuid4().hex
            value = {'id': identity, 'request': request, 'approvalSha256': browser_store.digest(request), 'expires': time.monotonic() + 180}
            self._proposals[identity] = value
            return {key: val for key, val in value.items() if key != 'expires'}

    def approve_action(self, body):
        self.require()
        if body.keys() != {'proposalId', 'approvalSha256'}:
            reject('EDGE_APPROVAL_REJECTED', '需要精确操作批准。', 400)
        with self._lock:
            proposal = self._proposals.get(body['proposalId'])
            if not proposal or proposal['expires'] < time.monotonic() or body['approvalSha256'] != proposal['approvalSha256']:
                reject('EDGE_APPROVAL_REJECTED', '操作批准已过期或摘要不一致。', 409)
            request = proposal['request']
            binding = self._binding(request['binding']['id'])
            if binding != request['binding']:
                reject('EDGE_SNAPSHOT_CHANGED', '页面快照已变化，请重新审查操作。', 409)
            if binding['id'] in self._busy:
                reject('EDGE_OPERATION_PENDING', '标签页已有执行中的操作。', 409)
            self._proposals.pop(proposal['id'])
            self._busy.add(binding['id'])
        keep_snapshot = False
        try:
            record = self.bridge.command(binding['instanceId'], request['action'], request['params'], binding=binding['id'], approval=body['approvalSha256'])
            self._observe_result(binding, record)
            data = (record.get('result') or {}).get('data') or {}
            # Continue only from a new, identity-checked post-action observation.
            # This does not reuse or authorize replay of the approved snapshot.
            keep_snapshot = (record['state'] == 'RESULT' and record['result'].get('ok') is True
                             and data.get('actionIssued') is True
                             and data.get('source') == 'ACTION_AND_FRESH_DOM_OBSERVATION'
                             and isinstance(data.get('snapshot'), str) and bool(data['snapshot'])
                             and binding.get('snapshotId') is not None
                             and int(binding['snapshotId'][1:]) > int(request['binding']['snapshotId'][1:]))
        finally:
            with self._lock:
                if not keep_snapshot:
                    binding['snapshotId'] = None
                    binding.pop('snapshotSha256', None)
                    binding.pop('snapshotOperationId', None)
                self._busy.discard(binding['id'])
        return {'operation': record, 'binding': dict(binding)}

    def handoff(self, body):
        if body.keys() != {'bindingId'}:
            reject('EDGE_REQUEST_REJECTED', '接管请求不正确。', 400)
        with self._lock:
            binding = self._binding(body['bindingId'])
            if binding['id'] in self._busy:
                reject('EDGE_OPERATION_PENDING', '当前操作还未确认，请先核对执行记录。', 409)
            binding['active'] = False
            binding['snapshotId'] = None
        return {'binding': dict(binding), 'handoffRequired': True, 'message': '已停止对此标签页的后续派发，请在 Edge 中操作；返回后重新选择页面。'}

    def close(self):
        self.bridge.close()
