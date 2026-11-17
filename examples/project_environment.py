"""Explicit host command: build a pinned Python dependency image, not an Agent tool.

Run only with a reviewed hash-locked requirements file. Network access is used
at image preparation time; Agent commands continue to have no network.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from uuid import uuid4


def validate_lock(text):
    lines=[]
    for raw in text.splitlines():
        line=raw.split('#',1)[0].strip()
        if line:
            lines.append(line)
    normalized=' '.join(lines).replace('\\',' ')
    packages=re.findall(r'(?:^|\s)([A-Za-z0-9][A-Za-z0-9_.-]*==[A-Za-z0-9_.+!-]+)((?:\s+--hash=sha256:[a-f0-9]{64})+)',normalized)
    reconstructed=' '.join(name+hashes for name,hashes in packages)
    if not packages or ' '.join(normalized.split())!=' '.join(reconstructed.split()):
        raise ValueError('Use only exact package==version entries with SHA256 hashes; no URLs, options or markers.')
    return packages


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-image',required=True,help='Already installed full sha256 image ID')
    parser.add_argument('--requirements',type=Path,required=True)
    parser.add_argument('--receipt',type=Path,required=True)
    args=parser.parse_args()
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',args.base_image):
        parser.error('base-image must be a full immutable image ID')
    raw=args.requirements.read_bytes()
    if len(raw)>256*1024:
        parser.error('requirements file exceeds 256 KiB')
    packages=validate_lock(raw.decode('utf-8-sig'))
    docker=shutil.which('docker')
    if not docker:
        parser.error('Docker is required')
    command=[docker,'--host='+('npipe:////./pipe/dockerDesktopLinuxEngine' if os.name=='nt' else 'unix:///var/run/docker.sock')]
    alias='axis-evo-build-base:'+uuid4().hex
    subprocess.run([*command,'tag',args.base_image,alias],check=True,capture_output=True)
    with tempfile.TemporaryDirectory(prefix='axis-environment-') as temporary:
        root=Path(temporary)
        (root/'requirements.lock').write_bytes(raw)
        (root/'Dockerfile').write_text('FROM '+alias+'\nCOPY requirements.lock /tmp/axis-requirements.lock\n'
            'RUN python -m pip install --disable-pip-version-check --no-cache-dir --require-hashes -r /tmp/axis-requirements.lock\n',encoding='utf-8')
        image_file=root/'image-id'
        try:
            built=subprocess.run([*command,'build','--progress=plain','--pull=false','--iidfile',str(image_file),str(root)],
                capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=600,
                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        finally:
            subprocess.run([*command,'image','rm',alias],capture_output=True,check=False)
        print(built.stdout+built.stderr,flush=True)
        built.check_returncode()
        image=image_file.read_text().strip()
        if not re.fullmatch(r'sha256:[a-f0-9]{64}',image):
            raise ValueError('Unconfirmed image ID')
        inventory=subprocess.run([*command,'run','--rm','--network','none','--read-only','--cap-drop','ALL',
            '--security-opt','no-new-privileges','--user','65534:65534','--entrypoint','python',image,
            '-m','pip','freeze','--all'],capture_output=True,check=True,text=True,timeout=60,
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)).stdout
    receipt={'baseImageId':args.base_image,'imageId':image,'requirementsSha256':hashlib.sha256(raw).hexdigest(),
        'packages':[name for name,_ in packages],'installed':inventory.splitlines(),
        'networkScope':'EXPLICIT_HOST_IMAGE_BUILD_ONLY','agentNetwork':'NONE'}
    args.receipt.parent.mkdir(parents=True,exist_ok=True)
    args.receipt.write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps(receipt))


if __name__=='__main__':
    main()
