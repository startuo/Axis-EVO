"""Generate standard Office/PDF documents and record independently verified bytes."""
import hashlib
from io import BytesIO
import math
import os
from pathlib import Path
import re
from uuid import uuid4
from xml.sax.saxutils import escape

from .agent_documents import MAX_DOCUMENT_BYTES, _pdf_reader
from .agent_fileops import pinned_parents
from .agent_workspace import DOCUMENT_SUFFIXES, fail, relative_path
from .schemas import ApiError, no_redirected_parents


def _invalid():
    fail('DOCUMENT_OUTLINE_INVALID', '文档大纲字段或数量超出允许范围，请核对格式。', 422)


def _mapping(value, required, optional=()):
    if type(value) is not dict or not set(required) <= value.keys() <= set(required) | set(optional):
        _invalid()
    return value


def _items(value, maximum, *, required=False):
    if type(value) is not list or not int(required) <= len(value) <= maximum:
        _invalid()
    return value


def _text(value, maximum=4000):
    if type(value) is not str or len(value) > maximum or any(ord(c) < 32 and c not in '\n\t\r' for c in value):
        _invalid()
    return value


def _grid(value, maximum_rows=160):
    rows = _items(value, maximum_rows, required=True)
    for row in rows:
        _items(row, 48, required=True)
        for cell in row:
            if type(cell) is str:
                _text(cell)
            elif cell is not None and (type(cell) not in (bool, int, float)
                    or type(cell) is float and not math.isfinite(cell)):
                _invalid()
    return rows


def _label(value):
    return '' if value is None else str(value)


def _blocks(data):
    _mapping(data, ('blocks',), ('title',))
    title = _text(data.get('title', ''), 160)
    blocks = _items(data['blocks'], 100, required=True)
    for block in blocks:
        if type(block) is not dict:
            _invalid()
        kind = block.get('type')
        if kind == 'heading':
            _mapping(block, ('type','text'), ('level',))
            _text(block['text'])
            level = block.get('level', 1)
            if type(level) is not int or not 1 <= level <= 9:
                _invalid()
        elif kind == 'paragraph':
            _mapping(block, ('type','text'))
            _text(block['text'])
        elif kind == 'list':
            _mapping(block, ('type','items'))
            for item in _items(block['items'], 40, required=True):
                _text(item)
        elif kind == 'table':
            _mapping(block, ('type','rows'))
            _grid(block['rows'])
        else:
            _invalid()
    return title, blocks


def _word(data, output):
    from docx import Document
    title, blocks = _blocks(data)
    doc = Document()
    if title:
        doc.add_heading(title, level=0)
    for block in blocks:
        kind = block['type']
        if kind == 'heading':
            doc.add_heading(block['text'], level=block.get('level',1))
        elif kind == 'paragraph':
            doc.add_paragraph(block['text'])
        elif kind == 'list':
            for line in block['items']:
                doc.add_paragraph(line, style='List Bullet')
        else:
            rows = block['rows']
            table = doc.add_table(rows=len(rows), cols=max(map(len,rows)))
            table.style = 'Table Grid'
            for target, row in zip(table.rows, rows):
                for cell, value in zip(target.cells, row):
                    cell.text = _label(value)
    doc.save(output)
    return {'summary':title, 'blockCount':len(blocks)}


def _workbook(data, output):
    from openpyxl import Workbook
    from openpyxl.styles import Font
    from openpyxl.utils import get_column_letter
    _mapping(data, ('sheets',))
    source = _items(data['sheets'], 16, required=True)
    book = Workbook()
    book.remove(book.active)
    names = set()
    for spec in source:
        _mapping(spec, ('name','rows'), ('headers','columnWidths'))
        name = _text(spec['name'],31)
        if not name.strip() or re.search(r'[\\/*?:\[\]]',name) or name.casefold() in names:
            _invalid()
        names.add(name.casefold())
        sheet = book.create_sheet(name)
        values = _grid(spec['rows']) if spec['rows'] else []
        if 'headers' in spec:
            header, = _grid([spec['headers']])
            sheet.append(header)
            for cell in sheet[1]:
                cell.font = Font(bold=True)
            sheet.freeze_panes='A2'
        for row in values:
            sheet.append(row)
        # Workspace output cells are literal data, including leading '='.
        for row in sheet.iter_rows():
            for cell in row:
                if isinstance(cell.value, str):
                    cell.data_type='s'
        if 'columnWidths' in spec:
            for index,width in enumerate(_items(spec['columnWidths'],48),1):
                if type(width) not in (int,float) or not 4 <= width <= 80:
                    _invalid()
                sheet.column_dimensions[get_column_letter(index)].width=width
    book.save(output)
    book.close()
    return {'summary':' / '.join(entry['name'] for entry in source)[:160], 'sheetCount':len(source)}


def _presentation(data, output):
    from pptx import Presentation
    from pptx.util import Inches, Pt
    _mapping(data, ('slides',))
    source = _items(data['slides'], 32, required=True)
    slides = Presentation()
    slides.slide_width, slides.slide_height = Inches(13.333), Inches(7.5)
    for spec in source:
        _mapping(spec, ('title',), ('points','notes','table'))
        slide = slides.slides.add_slide(slides.slide_layouts[5])
        slide.shapes.title.text = _text(spec['title'], 160)
        points = _items(spec.get('points',[]), 12)
        if points:
            height = Inches(2.5 if 'table' in spec else 5.5)
            shape = slide.shapes.add_textbox(Inches(.8), Inches(1.6), Inches(11.7), height)
            shape.text_frame.word_wrap = True
            for index, point in enumerate(points):
                paragraph = shape.text_frame.paragraphs[0] if index == 0 else shape.text_frame.add_paragraph()
                paragraph.text = '• '+_text(point,600)
                paragraph.font.size = Pt(18 if 'table' in spec else 22)
        if 'table' in spec:
            rows = _grid(spec['table'], 12)
            columns = max(map(len,rows))
            if columns > 12:
                _invalid()
            y = Inches(4.3 if points else 1.7)
            table=slide.shapes.add_table(len(rows),columns, Inches(.8), y, Inches(11.7), Inches(2.5)).table
            for row_index, row in enumerate(rows):
                for column, value in enumerate(row):
                    table.cell(row_index,column).text=_label(value)
        if 'notes' in spec:
            slide.notes_slide.notes_text_frame.text = _text(spec['notes'])
    slides.save(output)
    return {'summary':source[0]['title'], 'pageCount':len(source)}


def _pdf_font(values):
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    chars = {ord(c) for text in values for c in text if c not in '\r\n\t'}
    if all(code < 128 for code in chars):
        return 'Helvetica'
    fonts = []
    if system := os.environ.get('SystemRoot'):
        fonts = [Path(system)/'Fonts'/name for name in ('simhei.ttf','simfang.ttf','simsunb.ttf')]
    for path in fonts:
        if not path.is_file():
            continue
        name = 'AxisDocument' + path.stem
        if name in pdfmetrics.getRegisteredFontNames():
            font = pdfmetrics.getFont(name)
        else:
            font = TTFont(name, str(path))
        if chars <= font.face.charToGlyph.keys():
            pdfmetrics.registerFont(font)
            return name
    fail('DOCUMENT_PDF_FONT_UNAVAILABLE', '系统缺少可覆盖所需文字的 PDF 字体。请安装黑体、仿宋，或改用 DOCX。', 422)


def _pdf(data, output):
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle
    title, blocks = _blocks(data)
    values = [title]
    for block in blocks:
        if 'text' in block:
            values.append(block['text'])
        elif 'items' in block:
            values.extend(block['items'])
        else:
            values.extend(_label(value) for row in block['rows'] for value in row)
    font = _pdf_font(values)
    styles = {
        'body':ParagraphStyle('AxisBody',fontName=font,fontSize=12,leading=19,spaceAfter=7,wordWrap='CJK'),
        'heading':ParagraphStyle('AxisHeading',fontName=font,fontSize=16,leading=23,spaceAfter=11,wordWrap='CJK'),
    }
    def paragraph(text, style='body'):
        return Paragraph(escape(text).replace('\n','<br/>'), styles[style])
    story = [paragraph(title,'heading')] if title else []
    for block in blocks:
        if block['type'] in ('heading','paragraph'):
            story.append(paragraph(block['text'],'heading' if block['type']=='heading' else 'body'))
        elif block['type'] == 'list':
            story.extend(paragraph(f'{index}. {text}') for index,text in enumerate(block['items'],1))
        else:
            columns = max(map(len,block['rows']))
            if columns > 12:
                _invalid()
            rows = [[paragraph(_label(value)) for value in row] + ['']*(columns-len(row)) for row in block['rows']]
            table = Table(rows,colWidths=[460/columns]*columns)
            table.setStyle(TableStyle([('GRID',(0,0),(-1,-1),.35,colors.HexColor('#bebebe')),
                                       ('VALIGN',(0,0),(-1,-1),'TOP')]))
            story.append(table)
    SimpleDocTemplate(output, title=title, author='Axis-Evo').build(story)
    with _pdf_reader(output.getvalue()) as document:
        return {'summary':title, 'pageCount':len(document.pages)}


def build_document(extension, data):
    writers = {'.docx':_word, '.xlsx':_workbook, '.pptx':_presentation, '.pdf':_pdf}
    if extension not in writers:
        fail('DOCUMENT_FORMAT_UNSUPPORTED', '请选择 .docx、.xlsx、.pptx 或 .pdf。',415)
    output = BytesIO()
    try:
        metadata = writers[extension](data, output)
    except ApiError:
        raise
    except ImportError:
        fail('DOCUMENT_DEPENDENCIES_MISSING', '当前环境缺少文档依赖，请安装工作台依赖后重试。', 503)
    except (ValueError, TypeError, OverflowError, KeyError, OSError) as error:
        raise ApiError('DOCUMENT_GENERATION_FAILED', '无法根据该大纲生成文档，请核对格式与内容。',422) from error
    raw=output.getvalue()
    if not raw or len(raw)>MAX_DOCUMENT_BYTES:
        fail('DOCUMENT_SIZE_LIMIT', '生成的文档超过大小上限。', 413)
    return raw, {'format':extension[1:], **metadata}


def _persist(stream, raw):
    stream.write(raw)
    stream.flush()
    os.fsync(stream.fileno())


def write_document(service, turn, call_id, args):
    wid=turn['workspaceId']
    path=relative_path(args['path'], suffixes=DOCUMENT_SUFFIXES)
    expected=args['expectedSha256']
    if expected is not None and (type(expected) is not str or not re.fullmatch('[a-f0-9]{64}',expected)):
        fail('FILE_EXPECTED_DIGEST','覆盖需要原文件的 SHA-256。')
    resolver=service.workspaces.resolver(wid,write=True)
    raw, metadata=build_document(Path(path).suffix.lower(), args['document'])
    no_redirected_parents(resolver.root/path)
    target=resolver.resolve(path)
    directory=service.store.directory/'agent-files'/('file_'+uuid4().hex)
    with pinned_parents(resolver, [target]):
        no_redirected_parents(resolver.root/path)
        existed=target.exists()
        if existed != (expected is not None):
            fail('FILE_CHANGED','文件已存在或内容已变化，请先读取。',409)
        no_redirected_parents(directory)
        if existed:
            with target.open('r+b') as saved:
                before=saved.read(MAX_DOCUMENT_BYTES+1)
                if len(before)>MAX_DOCUMENT_BYTES or hashlib.sha256(before).hexdigest()!=expected:
                    fail('FILE_CHANGED','文件已变化，请用 read_document 核对原件。',409)
                directory.mkdir(parents=True)
                with (directory/'before.bin').open('xb') as backup:
                    _persist(backup,before)
                saved.seek(0)
                if saved.read(MAX_DOCUMENT_BYTES+1)!=before or not os.path.samestat(os.fstat(saved.fileno()), target.lstat()):
                    fail('FILE_CHANGED','文件在备份后发生变化，请重新核对。',409)
                service.bind_execution(turn,call_id,'filesystem',
                    {'operation':'write_document','path':path,'directory':str(directory)})
                saved.seek(0)
                saved.write(raw)
                saved.truncate()
                saved.flush()
                os.fsync(saved.fileno())
                file_info = os.fstat(saved.fileno())
        else:
            directory.mkdir(parents=True)
            service.bind_execution(turn,call_id,'filesystem',
                {'operation':'write_document','path':path,'directory':str(directory)})
            with target.open('xb') as saved:
                _persist(saved,raw)
                file_info = os.fstat(saved.fileno())
        with target.open('rb') as saved:
            if not os.path.samestat(file_info, os.fstat(saved.fileno())) or saved.read(MAX_DOCUMENT_BYTES+1)!=raw:
                raise RuntimeError('DOCUMENT_WRITE_UNCONFIRMED')
        with (directory/'after.bin').open('xb') as retained:
            _persist(retained,raw)
        facts={'path':path,'filename':Path(path).name,'sha256':hashlib.sha256(raw).hexdigest(),
                'sizeBytes':len(raw),'verification':'EXACT_BYTES','previousSha256':expected,'document':metadata}
        artifact=service.store.append('artifact',{**facts,'directory':str(directory)},wid,turn['id'])
    return {'artifactId':artifact['id'],'verified':True,**facts}
