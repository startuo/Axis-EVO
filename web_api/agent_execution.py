"""Run untrusted project commands only in an explicitly granted Linux container.

The Docker daemon/image remain trusted dependencies. This is container isolation,
not a claim of protection against kernel/daemon vulnerabilities or the OS owner.
No host directory, socket, credential or environment is mounted into the container.
"""
import json
import os
import re
import shutil
import subprocess
import threading
import time
from uuid import uuid4

from .agent_workspace import fail

MAX_OUTPUT = 64 * 1024
IMAGE_ID = re.compile(r'sha256:[a-f0-9]{64}\Z')
BOOTSTRAP = 'umask 077; mkdir /tmp/project && tar -xf - -C /tmp/project && cd /tmp/project && exec timeout -s KILL {seconds} env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp PYTHONDONTWRITEBYTECODE=1 "$@" </dev/null'


def validate_argv(argv):
    if (type(argv) is not list or not 1 <= len(argv) <= 64
            or any(type(arg) is not str or len(arg.encode('utf-8'))>4096 or '\x00' in arg for arg in argv)
            or not argv[0] or sum(len(arg.encode('utf-8')) for arg in argv)>12000):
        fail('EXECUTION_ARGUMENTS', '命令需为有界的参数数组。')
    return argv


class ContainerRunner:
    def __init__(self):
        executable = shutil.which('docker')
        self.command = [executable, '--host='+('npipe:////./pipe/dockerDesktopLinuxEngine'
            if os.name=='nt' else 'unix:///var/run/docker.sock')] if executable else None

    def _cli(self, args, timeout=10):
        if self.command is None:
            fail('EXECUTION_UNAVAILABLE', '未找到 Docker；不会改为在本机直接执行。', 409)
        try:
            result = subprocess.run([*self.command, *args], stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        except (OSError, subprocess.TimeoutExpired):
            fail('EXECUTION_UNAVAILABLE', '无法连接本机 Docker Linux 引擎。', 409)
        if result.returncode or len(result.stdout)>2*1024*1024:
            fail('EXECUTION_DOCKER_FAILED', 'Docker 未确认此操作；请检查本机执行环境。', 409)
        return result.stdout.decode('utf-8').strip()

    def image(self, image_id):
        if type(image_id) is not str or not IMAGE_ID.fullmatch(image_id):
            fail('EXECUTION_IMAGE_REQUIRED', '请选择本机已安装镜像的完整 SHA256 标识。')
        if self._cli(['info','--format','{{.OSType}}'])!='linux':
            fail('EXECUTION_PLATFORM', '目前只支持本机 Linux 容器引擎。', 409)
        value=json.loads(self._cli(['image','inspect','--format',
            '{"id":{{json .Id}},"os":{{json .Os}},"volumes":{{json (index .Config "Volumes")}}}', image_id]))
        if value['id']!=image_id or value['os']!='linux' or value['volumes']:
            fail('EXECUTION_IMAGE_UNSUPPORTED', '镜像需为 Linux 且不声明自动挂载卷。', 409)
        return image_id

    def status(self):
        try:
            if self._cli(['info','--format','{{.OSType}}'])!='linux':
                fail('EXECUTION_PLATFORM', '需要 Linux 容器引擎。', 409)
            lines=self._cli(['image','ls','--no-trunc','--format','{{json .}}']).splitlines()
            images=[]
            for line in lines[:64]:
                row=json.loads(line)
                if IMAGE_ID.fullmatch(row['ID']) and not any(item['id']==row['ID'] for item in images):
                    images.append({'id':row['ID'],'name':row['Repository']+':'+row['Tag']})
            return {'available':True,'engine':'LOCAL_DOCKER_LINUX','images':images,
                'isolation':'No network, no host mounts, non-root, read-only image, temporary project copy.'}
        except Exception:
            return {'available':False,'engine':'LOCAL_DOCKER_LINUX','images':[],
                'reason':'Docker Linux 引擎不可用；没有宿主执行回退。'}

    def _readonly_input(self, snapshot, image_id):
        """Populate a private Docker volume with a trusted unpacker, never project code."""
        volume='axis-m5-input-'+uuid4().hex
        self._cli(['volume','create','--label','axis-evo.execution=m5',volume])
        helper=None
        try:
            helper=self._cli(['create','--pull','never','--network','none','--read-only',
                '--cap-drop','ALL','--security-opt','no-new-privileges','--user','0:0',
                '--memory','128m','--cpus','1','--pids-limit','16','--log-driver','none','--no-healthcheck',
                '--mount','type=volume,source='+volume+',target=/input', '--entrypoint','/bin/sh','-i',
                image_id,'-c','umask 022; tar -xf - -C /input --no-same-owner && chmod -R a-w,a+rX /input'])
            result=subprocess.run([*self.command,'start','--attach','--interactive',helper],
                input=snapshot['archive'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15,
                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if result.returncode:
                fail('EXECUTION_INPUT_FAILED','无法准备只读验证副本。',409)
            return volume
        except Exception:
            if helper:
                self._cli(['rm','--force',helper]); helper=None
            self._cli(['volume','rm',volume])
            raise
        finally:
            if helper:
                self._cli(['rm','--force',helper])

    def run(self, snapshot, image_id, argv, *, timeout=60, cancelled=lambda:False, on_prepared=lambda ref:None,
            readonly=False):
        validate_argv(argv)
        if type(timeout) is not int or not 1<=timeout<=120:
            fail('EXECUTION_TIMEOUT', '单次命令时限需为1至120秒。')
        self.image(image_id)
        if cancelled():
            return {'status':'CANCELLED','outcome':'NOT_STARTED','exitCode':None}
        name='axis-m5-'+uuid4().hex
        volume=self._readonly_input(snapshot,image_id) if readonly else None
        args=['create','--name',name,'--label','axis-evo.execution=m5','--pull','never',
            '--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
            '--user','65534:65534','--memory','512m','--memory-swap','512m','--cpus','1',
            '--pids-limit','64','--ulimit','nofile=128:128','--ipc','none','--no-healthcheck',
            '--log-driver','none','--tmpfs','/tmp:rw,nosuid,nodev,size=134217728,mode=1777',
            '--workdir','/project' if readonly else '/tmp','--entrypoint','/bin/sh','-i']
        if volume:
            args.extend(['--mount','type=volume,source='+volume+',target=/project,readonly'])
        # The container also owns a deadline. If the coordinator disappears,
        # PID 1 still exits and Docker terminates the isolated process tree.
        bootstrap=('exec timeout -s KILL {seconds} env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp PYTHONDONTWRITEBYTECODE=1 "$@" </dev/null'
            if readonly else BOOTSTRAP).format(seconds=timeout)
        args.extend([image_id,'-c',bootstrap,'axis-command',*argv])
        try:
            container=self._cli(args,30)
        except Exception:
            if volume: self._cli(['volume','rm',volume])
            raise
        if not re.fullmatch('[a-f0-9]{64}',container):
            fail('EXECUTION_IDENTITY', '无法核对容器身份。', 409)
        started=False
        process=None
        result=None
        cleanup=False
        begin=time.monotonic()
        try:
            on_prepared({'containerId':container,'imageId':image_id,'snapshotSha256':snapshot['sha256'],
                'readonlyInputVolume':volume})
            if cancelled():
                return {'status':'CANCELLED','outcome':'NOT_STARTED','exitCode':None,'containerId':container}
            # Only the fixed Docker CLI runs on the host. All model arguments
            # appear after the immutable image and fixed container entrypoint.
            process=subprocess.Popen([*self.command,'start','--attach','--interactive',container],
                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            started=True
            output=bytearray()
            output_count=[0]
            def drain():
                while chunk:=process.stdout.read(4096):
                    output_count[0]+=len(chunk)
                    if len(output)<MAX_OUTPUT:
                        output.extend(chunk[:MAX_OUTPUT-len(output)])
            def feed():
                try:
                    process.stdin.write(b'' if readonly else snapshot['archive'])
                    process.stdin.close()
                except (OSError,ValueError):
                    pass
            reader=threading.Thread(target=drain,daemon=True)
            writer=threading.Thread(target=feed,daemon=True)
            reader.start(); writer.start()
            stop=None
            while process.poll() is None:
                if cancelled():
                    stop='CANCELLED'; break
                if time.monotonic()-begin>timeout:
                    stop='TIMED_OUT'; break
                time.sleep(.05)
            if stop:
                try:
                    self._cli(['kill',container])
                except Exception:
                    # The in-container deadline can win this race. Only the
                    # subsequent inspect may confirm termination.
                    pass
            process.wait(timeout=10)
            reader.join(timeout=5); writer.join(timeout=5)
            state=json.loads(self._cli(['inspect','--format','{{json .State}}',container]))
            confirmed=state.get('Status')=='exited' and not state.get('Running')
            if not stop and confirmed and state.get('ExitCode')==137 and time.monotonic()-begin>=timeout:
                stop='TIMED_OUT'
            result={'status':stop or ('SUCCESS' if confirmed else 'UNKNOWN'),
                'outcome':'EXITED' if confirmed else 'UNCONFIRMED','exitCode':state.get('ExitCode') if confirmed else None,
                'stdout':output.decode('utf-8',errors='replace'),'outputBytes':output_count[0],
                'outputTruncated':output_count[0]>MAX_OUTPUT,'durationMs':round((time.monotonic()-begin)*1000),
                'containerId':container,'imageId':image_id,'snapshotSha256':snapshot['sha256'],
                'oomKilled':bool(state.get('OOMKilled')),'effectScope':'EPHEMERAL_PROJECT_COPY',
                'network':'NONE','hostMounts':False,'trust':'UNTRUSTED_COMMAND_OUTPUT'}
            result['inputReadOnly']=readonly
            return result
        except Exception:
            if not started:
                raise
            result={'status':'UNKNOWN','outcome':'UNCONFIRMED','exitCode':None,'containerId':container,
                'snapshotSha256':snapshot['sha256'],'effectScope':'EPHEMERAL_PROJECT_COPY'}
            return result
        finally:
            try:
                self._cli(['rm','--force',container])
                cleanup=True
            except Exception:
                pass
            if process and process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            if volume and cleanup:
                try:
                    self._cli(['volume','rm',volume])
                except Exception:
                    cleanup=False
            if result is not None:
                result['cleanupConfirmed']=cleanup
