"""First-party workspace grants for isolated execution, separate from Skill text."""
import time
from .agent_execution import ContainerRunner, validate_argv
from .agent_project import snapshot, fixed_inputs
from .agent_store import digest
from .agent_workspace import fail


class AgentExecution:
    def __init__(self, service):
        self.service=service
        self.runner=ContainerRunner()

    def policy(self, wid):
        rows=self.service.store.records('execution_policy',workspace_id=wid,limit=1)
        return {'id':rows[0]['id'],**rows[0]['payload']} if rows else {
            'id':None,'enabled':False,'imageId':None,'timeoutSeconds':60,'checks':[], 'protectedPaths':[], 'protectedInputs':[]}

    def public_policy(self, wid):
        return {k:v for k,v in self.policy(wid).items() if k!='protectedInputs'}

    def is_protected(self, wid, path):
        import os
        policy=self.policy(wid)
        key=os.path.normcase(path).replace('\\','/')
        return policy['enabled'] and any(key==p or p.startswith(key+'/') for p in
            [os.path.normcase(p).replace('\\','/') for p in policy.get('protectedPaths',[])])

    def configure(self, wid, body):
        self.service.workspaces.get(wid)
        if (type(body) is not dict or not {'enabled','imageId','timeoutSeconds','checks'}<=body.keys()<={'enabled','imageId','timeoutSeconds','checks','protectedPaths'}
                or type(body['enabled']) is not bool or type(body['timeoutSeconds']) is not int
                or not 1<=body['timeoutSeconds']<=120 or type(body['checks']) is not list or len(body['checks'])>8):
            fail('EXECUTION_POLICY_INVALID','执行授权配置无效。')
        if body['enabled']:
            self.runner.image(body['imageId'])
        elif body['imageId'] is not None:
            # A disabled policy may retain a previously installed image identity.
            from .agent_execution import IMAGE_ID
            if type(body['imageId']) is not str or not IMAGE_ID.fullmatch(body['imageId']):
                fail('EXECUTION_POLICY_INVALID','镜像标识无效。')
        names=set()
        for check in body['checks']:
            if (type(check) is not dict or check.keys()!={'name','argv'} or type(check['name']) is not str
                    or not 1<=len(check['name'])<=80 or check['name'] in names):
                fail('EXECUTION_POLICY_INVALID','验证项需要唯一名称和命令参数。')
            validate_argv(check['argv'])
            names.add(check['name'])
        paths=body.get('protectedPaths',[]) if body['enabled'] else []
        if type(paths) is not list or len(paths)>64 or any(type(path) is not str for path in paths) or len(set(paths))!=len(paths):
            fail('EXECUTION_POLICY_INVALID','固定验证文件列表无效。')
        self.service.runtime.providers.check_text(str(body))
        with self.service._lock:
            protected=[]
            for path in paths:
                value=self.service.workspaces.read(wid,'workspace',path,max_chars=256*1024)
                if value['truncated'] or sum(len(row['content'].encode()) for row in protected)+value['sizeBytes']>256*1024:
                    fail('EXECUTION_POLICY_INVALID','固定验证材料超过256KiB。')
                # read() strips a BOM; reject that ambiguity for fixed check inputs.
                import hashlib
                if hashlib.sha256(value['content'].encode()).hexdigest()!=value['sha256']:
                    fail('EXECUTION_POLICY_INVALID','固定验证文件请使用无BOM的UTF-8。')
                protected.append({k:value[k] for k in ('path','content','sha256')})
            self.service.store.append('execution_policy',{**body,'protectedPaths':paths,'protectedInputs':protected},wid)
        return self.public_policy(wid)

    def execute(self, turn, call_id, argv, timeout=None, *, stdin_text=None):
        wid=turn['workspaceId']
        policy=self.policy(wid)
        if not policy['enabled']:
            fail('EXECUTION_NOT_AUTHORIZED','此工作区尚未授权隔离命令执行。',403)
        if turn['payload'].get('executionPolicyId')!=policy['id']:
            fail('EXECUTION_POLICY_CHANGED','执行授权已变化，请发起新任务。',409)
        if timeout is not None and (type(timeout) is not int or not 1<=timeout<=policy['timeoutSeconds']):
            fail('EXECUTION_TIMEOUT','命令时限超过工作区授权。')
        inputs=snapshot(self.service.workspaces,wid)
        record=self.service.store.append('command_snapshot',{'callId':call_id,'manifest':inputs['manifest'],
            'snapshotSha256':inputs['sha256'],'policyId':policy['id']},wid,turn['id'])
        result=self.runner.run(inputs,policy['imageId'],argv,timeout=timeout or policy['timeoutSeconds'],stdin_text=stdin_text,
            cancelled=lambda:self.service._cancelled(turn) or time.monotonic()>self.service._deadlines.get(turn['id'],float('inf')),
            on_prepared=lambda ref:self.service.bind_execution(turn,call_id,'container',ref))
        return {**result,'snapshotId':record['id'],'inputFiles':len(inputs['manifest']['files']),
            'argv':argv,'policyId':policy['id']}

    def verify(self, wid, parent_id, *, cancelled=lambda:False, fixed_snapshot=None, previous=None):
        """Run immutable user checks, including when the model elects not to test."""
        policy=self.policy(wid)
        if not policy['enabled'] or not policy['checks']:
            return {'status':'NOT_CONFIGURED','checks':[]}
        if cancelled():
            fail('EXECUTION_CANCELLED','验证授权已撤销或任务已停止。',409)
        inputs=fixed_inputs(fixed_snapshot or snapshot(self.service.workspaces,wid),policy.get('protectedInputs',[]))
        policy_sha=digest({k:v for k,v in policy.items() if k!='id'})
        if (previous and previous['snapshotSha256']==inputs['sha256']
                and previous['policySha256']==policy_sha):
            return previous
        checks=[]
        for index,check in enumerate(policy['checks']):
            if cancelled():
                fail('EXECUTION_CANCELLED','验证授权已撤销或任务已停止。',409)
            intent=self.service.store.append('verification_intent',{'check':check,'policyId':policy['id'],
                'snapshotSha256':inputs['sha256'],'manifest':inputs['manifest']},wid,parent_id)
            def prepared(ref):
                self.service.store.append('verification_execution',{'intentId':intent['id'],**ref},wid,parent_id)
            result=self.runner.run(inputs,policy['imageId'],check['argv'],timeout=policy['timeoutSeconds'],
                cancelled=cancelled,on_prepared=prepared,readonly=True)
            self.service.runtime.providers.check_text(str(result))
            passed=result['status']=='SUCCESS' and result['exitCode']==0
            receipt=self.service.store.append('verification_result',{'intentId':intent['id'],
                'checkIndex':index,'name':check['name'],'passed':passed,'result':result},wid,parent_id)
            checks.append({'name':check['name'],'passed':passed,'receiptId':receipt['id'],'result':result})
            if result['status']=='UNKNOWN':
                break
        return {'status':'PASSED' if len(checks)==len(policy['checks']) and all(c['passed'] for c in checks) else 'FAILED',
            'checks':checks,'policySha256':policy_sha,
            'snapshotSha256':inputs['sha256']}
