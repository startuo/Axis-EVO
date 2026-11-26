"""Bounded office previews and model-readable text, over checked workspace bytes."""
from contextlib import contextmanager
import csv
from io import BytesIO, StringIO
from pathlib import PurePosixPath
import re
from zipfile import BadZipFile, ZipFile

from .agent_workspace import DOCUMENT_SUFFIXES, LEGACY_DOCUMENT_SUFFIXES, RASTER_SUFFIXES, fail, relative_path
from .schemas import ApiError

MAX_DOCUMENT_BYTES = 12 * 1024 * 1024
MAX_EXPANDED_BYTES = 48 * 1024 * 1024
MAX_XML_BYTES = 12 * 1024 * 1024
MAX_COLUMNS = 96
MAX_PREVIEW_CHARS = 24000
MAX_ROWS_PER_PAGE = 60
MAX_PAGES_PER_READ = 20
MAX_SHEET_ROWS = 1_048_576
MAX_SHEET_COLUMNS = 16_384
WORD_XML = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
TABLE_SUFFIXES = frozenset(('.xlsx', '.csv', '.tsv'))
STRUCTURED_SUFFIXES = DOCUMENT_SUFFIXES | TABLE_SUFFIXES
RAW_MIME = {
    '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
}
_IMAGE_SIGNATURES = {
    'image/png': (b'\x89PNG\r\n\x1a\n',), 'image/jpeg': (b'\xff\xd8\xff',),
    'image/gif': (b'GIF87a', b'GIF89a'),
}


def image_signature(data, media_type):
    if media_type == 'image/webp':
        return len(data) >= 16 and data[:4] == b'RIFF' and data[8:12] == b'WEBP'
    return data.startswith(_IMAGE_SIGNATURES.get(media_type, ()))


def _safe_xml(raw):
    from defusedxml.ElementTree import fromstring
    return fromstring(raw, forbid_dtd=True, forbid_entities=True, forbid_external=True)


def _check_office(raw):
    with ZipFile(BytesIO(raw)) as archive:
        members = archive.infolist()
        paths = set()
        if len(members) > 2048 or sum(member.file_size for member in members) > MAX_EXPANDED_BYTES:
            fail('DOCUMENT_EXPANSION_LIMIT', 'Office 文档解压后超过安全预览上限。', 413)
        for member in members:
            name = member.filename
            path = PurePosixPath(name)
            key = name.casefold()
            if (key in paths or path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name):
                fail('DOCUMENT_INVALID', 'Office 文档包中的文件名称无效。', 422)
            paths.add(key)
            if ('vbaproject' in key or '/embeddings/' in key or member.flag_bits & 1):
                fail('DOCUMENT_ACTIVE_CONTENT', '带宏、嵌入对象或加密的 Office 文档无法预览。', 422)
            if key.endswith(('.xml', '.rels', '.vml')):
                if member.file_size > MAX_XML_BYTES:
                    fail('DOCUMENT_EXPANSION_LIMIT', '文档中的 XML 部件超过安全预览上限。', 413)
                xml = _safe_xml(archive.read(member))
                if key == '[content_types].xml' and any(
                        'macroenabled' in prop.get('ContentType', '').lower() for prop in xml):
                    fail('DOCUMENT_ACTIVE_CONTENT', '含宏的 Office 文档无法预览。', 422)
                for span in xml.iter(f'{WORD_XML}gridSpan'):
                    value = span.get(f'{WORD_XML}val', '')
                    if not value.isascii() or not value.isdecimal() or len(value) > 2 or not 1 <= int(value) <= 63:
                        fail('DOCUMENT_INVALID', 'Word 表格合并范围不符合文档格式。', 422)
        if '[content_types].xml' not in paths:
            fail('DOCUMENT_INVALID', 'Office 文档包缺少格式清单。', 422)


@contextmanager
def _pdf_reader(raw):
    from pypdf import PdfReader, apply_configuration
    from pypdf.errors import DependencyError
    if not raw.startswith(b'%PDF-'):
        fail('DOCUMENT_INVALID', '该文件的内容与 PDF 格式不符。', 422)
    with apply_configuration(jbig2dec_binary=None, page_tree_maximum_entries=16_000,
            maximum_declared_stream_length=MAX_DOCUMENT_BYTES,
            stream_decoding_work_maximum_length=MAX_EXPANDED_BYTES,
            array_based_stream_maximum_output_length=MAX_EXPANDED_BYTES,
            zlib_maximum_output_length=MAX_EXPANDED_BYTES):
        try:
            reader = PdfReader(BytesIO(raw), strict=True, xref_stream_maximum_entries=100_000)
        except DependencyError as error:
            if 'AES algorithm' in str(error):
                fail('DOCUMENT_ENCRYPTED', '此 PDF 需要密码，请在本机解密后重新打开。', 422)
            raise
        with reader as pdf:
            if pdf.is_encrypted:
                fail('DOCUMENT_ENCRYPTED', '此 PDF 需要密码，请在本机解密后重新打开。', 422)
            yield pdf


def _pdf_inline_allowed(document):
    """The browser's PDF engine can handle actions separately from page CSP."""
    from pypdf.generic import IndirectObject, NameObject
    denied = {'/JS','/JavaScript','/Launch','/SubmitForm','/ImportData','/RichMedia',
        '/RichMediaContent','/Rendition','/GoToE','/XFA'}
    pending = [document.root_object]
    seen = set()
    remaining = 100_000
    while pending:
        remaining -= 1
        value = pending.pop()
        if remaining < 0 or len(pending) > remaining:
            return False
        if isinstance(value, IndirectObject):
            key = (value.generation, value.idnum)
            if key in seen:
                continue
            seen.add(key)
            value = value.get_object()
        if isinstance(value, dict):
            if denied.intersection(value):
                return False
            pending.extend(value.values())
        elif isinstance(value, list):
            pending.extend(value)
        elif isinstance(value, NameObject) and value in denied:
            return False
    return True


class _TextBudget:
    def __init__(self, maximum):
        self.remaining = maximum
        self.truncated = False

    def take(self, value):
        value = '' if value is None else str(value)
        prefix = value[:self.remaining]
        self.remaining -= len(prefix)
        self.truncated |= len(prefix) < len(value)
        return prefix

    def row(self, cells):
        return [self.take(c) for c in list(cells)[:MAX_COLUMNS]]


def _window(total, start, end):
    if start > max(1, total) or end is not None and end < start:
        fail('DOCUMENT_RANGE_INVALID', '请选择文档实际范围内的页码。')
    return range(start - 1, min(total, start - 1 + MAX_PAGES_PER_READ, end or total))


def _pdf(raw, budget, start, end):
    with _pdf_reader(raw) as document:
        inline_available = _pdf_inline_allowed(document)
        total = len(document.pages)
        pages = []
        for idx in _window(total, start, end):
            text = document.pages[idx].extract_text()
            pages.append({'page':idx+1, 'text':budget.take(text), 'scanLikely':len(text.strip()) < 12})
            if budget.truncated:
                break
    last = pages[-1]['page'] if pages else 0
    return {'kind':'pdf','totalPages':total,'pages':pages,'nextPage':last+1 if last<total else None,
            'scanLikely':bool(pages) and all(page['scanLikely'] for page in pages),
            'inlineAvailable':inline_available}


def _word(raw, budget):
    from docx import Document
    from docx.text.paragraph import Paragraph
    doc = Document(BytesIO(raw))
    blocks, paragraph_count, words = [], 0, 0
    word = re.compile(r'[\u3400-\u9fff]|[^\W_]+')
    for part in doc.iter_inner_content():
        if isinstance(part, Paragraph):
            value = part.text
            paragraph_count += 1
            words += sum(1 for _ in word.finditer(value))
            if len(blocks) >= 240 or budget.remaining <= 0:
                budget.truncated = True
                continue
            style = part.style.style_id
            heading = re.fullmatch(r'Heading([1-9])', style, re.I)
            listing = part._p.pPr is not None and part._p.pPr.numPr is not None or style.casefold().startswith('list')
            block = {'type':'heading' if heading else 'list' if listing else 'paragraph', 'text':budget.take(value)}
            if heading:
                block['level'] = int(heading[1])
            blocks.append(block)
        else:
            rows = []
            for row in part.rows:
                values = [cell.text for cell in row.cells]
                words += sum(1 for value in values for _ in word.finditer(value))
                if len(blocks) >= 240 or len(rows) >= MAX_ROWS_PER_PAGE or budget.remaining <= 0:
                    budget.truncated = True
                    continue
                budget.truncated |= len(values) > MAX_COLUMNS
                rows.append(budget.row(values))
            if rows:
                blocks.append({'type':'table', 'rows':rows})
    return {'kind':'word','blocks':blocks,'paragraphCount':paragraph_count,'wordCount':words}


def _sheet_data(names, name, total, columns, start, header, rows):
    return {'kind':'table','sheets':names,'sheet':name,'totalRows':total,'totalColumns':columns,
            'startRow':start,'header':header,'rows':rows,
            'nextRow':start+len(rows) if start+len(rows) <= total else None}


def _sheet_dimensions(sheet):
    total, columns = sheet.max_row, sheet.max_column
    if total is None or columns is None:
        # openpyxl's public force mode fills all missing rows. Read only
        # physical row records for workbooks without a dimension element.
        from openpyxl.worksheet._reader import WorkSheetParser
        total, columns = 0, 0
        with sheet._get_source() as stream:
            for row, cells in WorkSheetParser(stream, sheet._shared_strings, data_only=True,
                    epoch=sheet.parent.epoch).parse():
                if not 1 <= row <= MAX_SHEET_ROWS:
                    fail('DOCUMENT_INVALID', '工作表行坐标超出 Excel 范围。', 422)
                total = max(total, row)
                columns = max(columns, max((cell['column'] for cell in cells), default=0))
    if not 0 <= total <= MAX_SHEET_ROWS or not 0 <= columns <= MAX_SHEET_COLUMNS:
        fail('DOCUMENT_INVALID', '工作表行列坐标超出 Excel 范围。', 422)
    return total, columns


def _workbook(raw, budget, sheet, start, size):
    from openpyxl import load_workbook
    workbook = load_workbook(BytesIO(raw), read_only=True, data_only=True, keep_links=False)
    try:
        names = workbook.sheetnames
        name = names[0] if sheet is None else sheet
        if name not in names:
            fail('DOCUMENT_SHEET_MISSING', '工作簿中找不到指定的工作表。', 404)
        tab = workbook[name]
        if len(names) > 512 or any(len(name) > 80 for name in names):
            fail('DOCUMENT_EXPANSION_LIMIT', '工作表数量或名称超过安全预览上限。', 413)
        total, columns = _sheet_dimensions(tab)
        count = min(columns, MAX_COLUMNS)
        budget.truncated |= columns > count
        header = (budget.row(next(tab.iter_rows(min_row=1, max_row=1, max_col=count, values_only=True), ()))
                  if total else [])
        end = min(start+size-1,total)
        rows = ([header] if start == 1 and total else [])
        if count and end >= max(2,start):
            rows.extend(budget.row(values) for values in tab.iter_rows(
                min_row=max(2,start), max_row=end, max_col=count, values_only=True))
        return _sheet_data(names, name, total, columns, start, header, rows)
    finally:
        workbook.close()


def _delimiter(raw, budget, extension, sheet, start, size):
    name = '表格'
    if sheet not in (None, name):
        fail('DOCUMENT_SHEET_MISSING', '该表格只有一个工作表。', 404)
    delimiter = '\t' if extension == '.tsv' else ','
    reader = csv.reader(StringIO(raw.decode('utf-8-sig'), newline=''), delimiter=delimiter, strict=True)
    total, columns, header, rows = 0, 0, [], []
    for total, cells in enumerate(reader, 1):
        columns = max(columns, len(cells))
        if total == 1:
            header = budget.row(cells)
        if start <= total < start + size:
            rows.append(header if total == 1 else budget.row(cells))
    budget.truncated |= columns > MAX_COLUMNS
    return _sheet_data([name], name, total, columns, start, header, rows)


def _presentation(raw, budget, start, end):
    from pptx import Presentation
    doc = Presentation(BytesIO(raw))
    total = len(doc.slides)
    slides = []
    for index in _window(total, start, end):
        slide = doc.slides[index]
        heading = slide.shapes.title
        title = budget.take(heading.text if heading is not None else '')
        points, tables = [], []
        for shape in slide.shapes:
            if heading is not None and heading.shape_id == shape.shape_id:
                continue
            if shape.has_text_frame:
                for paragraph in shape.text_frame.paragraphs:
                    if paragraph.text.strip() and len(points) < 240 and budget.remaining:
                        points.append({'text':budget.take(paragraph.text), 'level':paragraph.level})
                    elif paragraph.text.strip():
                        budget.truncated = True
            if shape.has_table:
                budget.truncated |= len(shape.table.rows)>MAX_ROWS_PER_PAGE or len(shape.table.columns)>MAX_COLUMNS
                tables.append([budget.row(cell.text for cell in row.cells)
                    for i,row in enumerate(shape.table.rows) if i<MAX_ROWS_PER_PAGE and budget.remaining])
            if not budget.remaining:
                break
        notes = slide.notes_slide.notes_text_frame if slide.has_notes_slide else None
        slides.append({'page':index+1,'title':title,'points':points,'tables':tables,
                       'notes':budget.take(notes.text if notes is not None else '')})
        if budget.truncated:
            break
    last = slides[-1]['page'] if slides else 0
    return {'kind':'presentation','totalPages':total,'slides':slides,'nextPage':last+1 if last<total else None}


def _bounded_integer(value, maximum):
    if type(value) is not int or not 1 <= value <= maximum:
        fail('DOCUMENT_RANGE_INVALID', '页码、行号和预览大小需要在允许的范围内。')
    return value


def read_preview(workspaces, wid, path, *, source='workspace', sheet=None, start_row=1,
                 row_count=MAX_ROWS_PER_PAGE, start_page=1, end_page=None, max_chars=MAX_PREVIEW_CHARS):
    selected = relative_path(path, suffixes=STRUCTURED_SUFFIXES | LEGACY_DOCUMENT_SUFFIXES | RASTER_SUFFIXES | {'.svg'})
    extension = PurePosixPath(selected).suffix.lower()
    if extension in LEGACY_DOCUMENT_SUFFIXES:
        fail('DOCUMENT_FORMAT_UNSUPPORTED', '旧版 Office 二进制格式无法预览，请另存为 .docx、.xlsx 或 .pptx。', 415)
    start_row = _bounded_integer(start_row, 1_048_576)
    _bounded_integer(row_count, MAX_ROWS_PER_PAGE)
    _bounded_integer(start_page, 100_000)
    if end_page is not None:
        _bounded_integer(end_page, 100_000)
    if sheet is not None and (type(sheet) is not str or not sheet or len(sheet) > 80):
        fail('DOCUMENT_RANGE_INVALID', '请选择有效的工作表名称。')
    budget = _TextBudget(_bounded_integer(max_chars, MAX_PREVIEW_CHARS))
    meta, raw = workspaces.read_material(wid, source, selected,
        suffixes=STRUCTURED_SUFFIXES | set(RAW_MIME), limit=MAX_DOCUMENT_BYTES)
    try:
        if extension in DOCUMENT_SUFFIXES - {'.pdf'}:
            _check_office(raw)
        if extension == '.docx':
            result = _word(raw, budget)
        elif extension == '.xlsx':
            result = _workbook(raw, budget, sheet, start_row, row_count)
        elif extension in ('.csv', '.tsv'):
            result = _delimiter(raw, budget, extension, sheet, start_row, row_count)
        elif extension == '.pptx':
            result = _presentation(raw, budget, start_page, end_page)
        elif extension == '.pdf':
            result = _pdf(raw, budget, start_page, end_page)
        else:
            result = {'kind':'image', 'mediaType':checked_raw_type(extension, raw)}
    except ApiError:
        raise
    except ImportError:
        fail('DOCUMENT_DEPENDENCIES_MISSING', '当前运行环境缺少文档依赖，请安装工作台依赖后重试。', 503)
    except Exception as error:
        # Third-party file parsers use different exception types for malformed documents.
        raise ApiError('DOCUMENT_INVALID', '文件已经损坏，或内容与扩展名不符。', 422) from error
    return {**meta, **result, 'format':extension[1:], 'truncated':budget.truncated}


def checked_raw_type(extension, data):
    media = RAW_MIME.get(extension)
    if media is None:
        fail('DOCUMENT_FORMAT_UNSUPPORTED', '原始预览只支持 PDF 和允许的图片格式。', 415)
    try:
        if media == 'application/pdf':
            with _pdf_reader(data) as document:
                if not _pdf_inline_allowed(document):
                    fail('DOCUMENT_ACTIVE_CONTENT', '此 PDF 含活动内容或结构过大，可查看提取文本。', 422)
                return media
        if media == 'image/svg+xml':
            if _safe_xml(data).tag == '{http://www.w3.org/2000/svg}svg':
                return media
        if image_signature(data, media):
            return media
    except ApiError:
        raise
    except ImportError:
        fail('DOCUMENT_DEPENDENCIES_MISSING', '当前运行环境缺少文档依赖，请安装工作台依赖后重试。', 503)
    except Exception as error:
        raise ApiError('DOCUMENT_INVALID', '原始文件已损坏或无法安全预览。', 422) from error
    fail('DOCUMENT_INVALID', '文件内容与声明的格式不符。', 422)


def read_document(workspaces, wid, path, **options):
    maximum = options.get('max_chars', MAX_PREVIEW_CHARS)
    preview = read_preview(workspaces, wid, path, **options)
    kind = preview['kind']
    if kind == 'image':
        fail('DOCUMENT_FORMAT_UNSUPPORTED', '请使用 read_document 读取办公文档或文本表格。', 415)
    if kind == 'word':
        parts = []
        for block in preview['blocks']:
            tag = block['type']
            if tag == 'table':
                parts.append(_markdown_table(block['rows']))
            else:
                parts.append(('#' * block['level'] + ' ' if tag == 'heading' else '- ' if tag == 'list' else '')
                             + block['text'])
    elif kind == 'table':
        rows = preview['rows'][1:] if preview['startRow'] == 1 else preview['rows']
        parts = [f"工作表 {preview['sheet']}（共 {preview['totalRows']} 行 × {preview['totalColumns']} 列）",
                 _markdown_table([preview['header'], *rows])]
    elif kind == 'presentation':
        parts = []
        for slide in preview['slides']:
            parts.append(f"## 第 {slide['page']} 页 {slide['title']}")
            parts.extend('- '+item['text'] for item in slide['points'])
            parts.extend(_markdown_table(table) for table in slide['tables'])
            if slide['notes']:
                parts.append('演讲者备注\n'+slide['notes'])
    else:
        parts = [f"## 第 {page['page']} 页\n{page['text']}" for page in preview['pages']]
    text = '\n\n'.join(parts)
    if kind == 'pdf' and preview['scanLikely']:
        text += '\n\n这些页的文本很少，可能是扫描件。可以截图或转成图片后提交视觉识别。'
    partial = (preview['truncated'] or len(text) > maximum or preview.get('nextPage') is not None
        or preview.get('nextRow') is not None or options.get('start_page', 1)>1 or options.get('start_row', 1)>1)
    public = {key:value for key,value in preview.items() if key not in ('blocks','slides','pages','rows','header','truncated')}
    result = {**public,'content':text[:maximum],'coverage':'PARTIAL' if partial else 'FULL',
              'truncated':partial,'trust':'UNTRUSTED_MATERIAL'}
    workspaces.providers.check_text(result['content'])
    return result


def _markdown_table(rows):
    if not rows:
        return ''
    columns = max(len(row) for row in rows)
    if columns == 0:
        return ''
    def render(row):
        cells = [cell.replace('|','\\|').replace('\n',' ') for cell in row]
        return '| '+' | '.join(cells + ['']*(columns-len(cells)))+' |'
    return '\n'.join([render(rows[0]), render(['---']*columns), *(render(row) for row in rows[1:])])
