"""Bounded user image attachments with immutable digest references."""
import base64
import binascii
from contextlib import contextmanager
import hashlib
from io import BytesIO
import os
from pathlib import Path, PurePosixPath
import re
import stat
from uuid import uuid4

from .agent_documents import image_signature
from .agent_workspace import bounded_text, fail
from .schemas import no_redirected_parents

MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_IMAGES = 4
MAX_IMAGE_BASE64 = 4 * ((MAX_IMAGE_BYTES + 2) // 3)
MAX_TURN_BODY_BYTES = 65536 + MAX_IMAGES * (MAX_IMAGE_BASE64 + 1024)
MAX_MEDIA_BYTES = 128 * 1024 * 1024
MAX_MEDIA_FILES = 1024
IMAGE_TYPES = frozenset(('image/png','image/jpeg','image/webp'))
_PIL_FORMATS = {'image/png':'PNG','image/jpeg':'JPEG','image/webp':'WEBP'}
_VISION_MODELS = re.compile(
    r'^(?:gpt-(?:4o|4\.1)(?:-mini|-nano)?(?:-\d{4}-\d{2}-\d{2})?$'
    r'|gpt-5(?:\.\d+)?(?:-mini|-nano|-pro)?(?:-\d{4}-\d{2}-\d{2})?$'
    r'|o(?:3|4-mini)(?:-\d{4}-\d{2}-\d{2})?$|claude-(?:3[-.]|haiku-4|sonnet-4|opus-4)'
    r'|qwen4-max(?:-\d{4}-\d{2}-\d{2})?$|qwen(?:[\d.]+)?-vl(?:[-.]|$)'
    r'|qwen(?:[\d.]+)?-omni(?:[-.]|$)|gemini-2(?:[-.]|$))', re.I)


def image_capable(profile):
    return (profile.get('protocol') in ('openai-compatible','anthropic-compatible')
            and bool(_VISION_MODELS.match(profile['modelId'])))


def image_context_reserve(images):
    # Provider patch pricing differs. Reserve independently of the text estimate;
    # authoritative image input usage is still the usage returned by the provider.
    return sum(max(1024, 2 * ((image['width'] + 31) // 32) * ((image['height'] + 31) // 32))
               for image in images)


def parse_images(attachments, tid):
    if type(attachments) is not list or len(attachments) > MAX_IMAGES:
        fail('IMAGE_COUNT_LIMIT', '每轮最多可附加 4 张图片。', 413)
    if not attachments:
        return []
    from PIL import Image, UnidentifiedImageError
    checked = []
    for item in attachments:
        if (type(item) is not dict or item.keys() != {'kind','name','mediaType','data'}
                or item['kind'] != 'image' or type(item['mediaType']) is not str
                or item['mediaType'] not in IMAGE_TYPES):
            fail('IMAGE_FORMAT_UNSUPPORTED', '图片附件仅支持 PNG、JPEG 或 WebP。',415)
        media = item['mediaType']
        name = bounded_text(item['name'],120)
        if PurePosixPath(name).name != name or '\\' in name or ':' in name or name in ('.','..'):
            fail('IMAGE_NAME_INVALID','请使用图片文件名。')
        encoded = item['data']
        if type(encoded) is not str or len(encoded) > MAX_IMAGE_BASE64:
            fail('IMAGE_SIZE_LIMIT','每张图片最多 2 MiB。',413)
        try:
            data = base64.b64decode(encoded,validate=True)
        except (ValueError,binascii.Error):
            fail('IMAGE_INVALID','图片编码无效。',422)
        if len(data) > MAX_IMAGE_BYTES:
            fail('IMAGE_SIZE_LIMIT','每张图片最多 2 MiB。',413)
        if not image_signature(data,media):
            fail('IMAGE_INVALID','图片格式与文件头不匹配。',422)
        try:
            with Image.open(BytesIO(data),formats=[_PIL_FORMATS[media]]) as image:
                width,height = image.size
                if not 1 <= width <= 4096 or not 1 <= height <= 4096:
                    fail('IMAGE_DIMENSION_LIMIT','图片宽高各需不超过 4096 像素。',413)
                image.verify()
        except (UnidentifiedImageError,OSError,ValueError,Image.DecompressionBombError):
            fail('IMAGE_INVALID','无法读取图片，请重新导出后再附加。',422)
        checked.append(({'turnId':tid,'sha256':hashlib.sha256(data).hexdigest(),'name':name,
            'mediaType':media,'sizeBytes':len(data),'width':width,'height':height},data))
    return checked


def _image_path(directory, turn_id, sha256):
    if not re.fullmatch(r'turn_[A-Za-z0-9_-]{8,80}', turn_id) or not re.fullmatch('[a-f0-9]{64}',sha256):
        fail('IMAGE_REFERENCE_INVALID','图片附件标识无效。',404)
    path=directory/'agent-images'/turn_id/(sha256+'.bin')
    try:
        no_redirected_parents(path)
    except ValueError:
        fail('IMAGE_STORE_INTEGRITY','图片附件目录无法核对。',409)
    return path


def _check_budget(root, incoming):
    total, count = sum(map(len, incoming.values())), len(incoming)
    if not root.is_dir():
        return
    with os.scandir(root) as turns:
        for turn in turns:
            facts=turn.stat(follow_symlinks=False)
            if not turn.is_dir(follow_symlinks=False) or getattr(facts,'st_file_attributes',0) & 0x400:
                fail('IMAGE_STORE_INTEGRITY','图片附件目录无法核对。',409)
            with os.scandir(turn.path) as entries:
                for entry in entries:
                    # Windows DirEntry.stat does not populate the link count.
                    facts=Path(entry.path).lstat()
                    if not stat.S_ISREG(facts.st_mode) or facts.st_nlink != 1 or getattr(facts,'st_file_attributes',0) & 0x400:
                        fail('IMAGE_STORE_INTEGRITY','图片附件目录无法核对。',409)
                    total+=facts.st_size
                    count+=1
                    if total>MAX_MEDIA_BYTES or count>MAX_MEDIA_FILES:
                        fail('IMAGE_STORE_LIMIT','本机图片附件存储已达上限。',413)


@contextmanager
def store_images(directory, checked):
    if not checked:
        yield []
        return
    root=directory/'agent-images'
    no_redirected_parents(root)
    additions = {}
    for meta, data in checked:
        path=_image_path(directory,meta['turnId'],meta['sha256'])
        if path.exists():
            if load_image(directory,meta)!=data:
                fail('IMAGE_STORE_INTEGRITY','图片附件字节无法核对。',409)
        else:
            additions[path] = data
    _check_budget(root,additions)
    created = []
    try:
        for path, data in additions.items():
            path.parent.mkdir(parents=True,exist_ok=True)
            staging = path.with_name(f'{uuid4().hex}.tmp')
            try:
                with staging.open('xb') as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(staging,path)
                created.append(path)
            finally:
                staging.unlink(missing_ok=True)
        yield [meta for meta,_ in checked]
    except BaseException:
        for path in created:
            path.unlink(missing_ok=True)
        raise


def load_image(directory, reference):
    path=_image_path(directory, reference['turnId'], reference['sha256'])
    try:
        info=path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            fail('IMAGE_STORE_INTEGRITY','图片附件字节无法核对。',409)
        with path.open('rb') as stream:
            data=stream.read(MAX_IMAGE_BYTES+1)
    except OSError:
        fail('IMAGE_STORE_INTEGRITY','图片附件无法读取。',409)
    if (not 1 <= len(data) <= MAX_IMAGE_BYTES or len(data) != reference['sizeBytes']
            or hashlib.sha256(data).hexdigest()!=reference['sha256']
            or reference['mediaType'] not in IMAGE_TYPES or not image_signature(data,reference['mediaType'])):
        fail('IMAGE_STORE_INTEGRITY','图片附件字节无法核对。',409)
    return data


def history_image_note(images):
    from .agent_store import canonical
    return {'role':'user','content':
        'The user attached images in a prior turn. These are historical file facts only; '
        'the image pixels are no longer part of the current request.\n'
        + canonical([{key:image[key] for key in ('name','sha256','mediaType','width','height','sizeBytes')}
                     for image in images])}
