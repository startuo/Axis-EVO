import { useState, type JSX, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { workspaceFileUrl, type PreviewQuery, type StructuredPreview, type WordBlock } from '../../lib/filePreview';
import './officePreview.css';

type TablePreview = Extract<StructuredPreview, { kind: 'table' }>;
type WordPreview = Extract<StructuredPreview, { kind: 'word' }>;
type PresentationPreview = Extract<StructuredPreview, { kind: 'presentation' }>;
type PdfPreview = Extract<StructuredPreview, { kind: 'pdf' }>;
type ImagePreview = Extract<StructuredPreview, { kind: 'image' }>;

function Grid({ head, rows }: { head?: string[]; rows: string[][] }) {
  return (
    <div className="doc-grid-scroll" tabIndex={0} role="region" aria-label="表格">
      <table className="doc-grid">
        {head && <thead><tr>{head.map((cell, index) => <th scope="col" key={index}>{cell}</th>)}</tr></thead>}
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function WordBody({ preview }: { preview: WordPreview }) {
  const blocks: ((WordBlock & { index: number }) | { type: 'list-group'; texts: string[]; index: number })[] = [];
  preview.blocks.forEach((block, index) => {
    if (block.type !== 'list') { blocks.push({ ...block, index }); return; }
    const last = blocks.at(-1);
    if (last?.type === 'list-group') last.texts.push(block.text);
    else blocks.push({ type: 'list-group', texts: [block.text], index });
  });
  return (
    <article className="doc-scroll doc-word" aria-label="Word 预览">
      <p className="doc-meta">{preview.paragraphCount} 段 / {preview.wordCount} 字词</p>
      {blocks.map(block => {
        if (block.type === 'list-group') return <ul key={block.index}>{block.texts.map((item, i) => <li key={i}>{item}</li>)}</ul>;
        if (block.type === 'table') return <Grid key={block.index} rows={block.rows} />;
        if (block.type === 'heading') {
          const Heading = `h${Math.min(6, Math.max(1, block.level))}` as keyof Pick<JSX.IntrinsicElements, 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'>;
          return <Heading key={block.index}>{block.text}</Heading>;
        }
        return <p key={block.index}>{block.text}</p>;
      })}
    </article>
  );
}

function TableBody({ preview, query, change, busy }: PreviewProps<TablePreview>) {
  const start = preview.startRow;
  const first = query.startRow ?? 1;
  const last = Math.min(preview.totalRows, start + preview.rows.length - 1);
  const rows = start === 1 ? preview.rows.slice(1) : preview.rows;
  return (
    <section className="doc-preview doc-table" aria-label="表格预览" aria-busy={busy}>
      {preview.sheets.length > 1 && <div className="doc-sheet-tabs" role="group" aria-label="工作表">
        {preview.sheets.map(sheet => <button key={sheet} type="button" aria-pressed={(query.sheet ?? preview.sheet) === sheet}
          onClick={() => change({ sheet, startRow: 1 })}>{sheet}</button>)}
      </div>}
      <div className="doc-meta doc-controls">
        <span>{preview.totalRows} 行 × {preview.totalColumns} 列</span>
        <span>{preview.totalRows ? `${start}–${last}` : '空表'}</span>
        {first > 1 && <button type="button" disabled={busy}
          onClick={() => change({ ...query, startRow: Math.max(1, first - 60) })}>上一批</button>}
        <button type="button" disabled={busy || preview.nextRow === null}
          onClick={() => preview.nextRow !== null && change({ ...query, startRow: preview.nextRow })}>下一批</button>
      </div>
      <Grid head={preview.header} rows={rows} />
    </section>
  );
}

interface PreviewProps<T> { preview: T; query: PreviewQuery; change: (query: PreviewQuery) => void; busy: boolean }

function pageQuery(page: number): PreviewQuery { return { startPage: page, endPage: page }; }

function Pages({ page, total, setPage, busy }: { page: number; total: number; setPage: (page: number) => void; busy: boolean }) {
  return (
    <div className="doc-controls doc-pages" aria-label="翻页">
      <button className="icon-button" type="button" aria-label="上一页" disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>
        <ChevronLeft size={16} aria-hidden />
      </button>
      <span className="doc-meta">{total ? `${page} / ${total}` : '暂无页面'}</span>
      <button className="icon-button" type="button" aria-label="下一页" disabled={busy || page >= total} onClick={() => setPage(page + 1)}>
        <ChevronRight size={16} aria-hidden />
      </button>
    </div>
  );
}

function PresentationBody({ preview, query, change, busy }: PreviewProps<PresentationPreview>) {
  const slide = preview.slides[0];
  const page = query.startPage ?? 1;
  const setPage = (next: number) => change(pageQuery(next));
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || busy) return;
    const next = event.key === 'ArrowLeft' ? page - 1 : event.key === 'ArrowRight' ? page + 1 : page;
    if (next !== page && next > 0 && next <= preview.totalPages) {
      event.preventDefault();
      setPage(next);
    }
  };
  return (
    <section className="doc-preview" aria-label="幻灯片预览" tabIndex={0} onKeyDown={onKey} aria-busy={busy}>
      <Pages page={page} total={preview.totalPages} busy={busy} setPage={setPage} />
      {slide && <div className="doc-scroll doc-slide-wrap">
        <article className="doc-slide" aria-label={`幻灯片 ${slide.page}`}>
          <h2>{slide.title || `第 ${slide.page} 页`}</h2>
          {slide.points.length > 0 && <ul>{slide.points.map((point, index) =>
            <li key={index} style={{ marginInlineStart: `${Math.min(4, point.level) * 1.1}em` }}>{point.text}</li>)}</ul>}
          {slide.tables.map((rows, index) => <Grid rows={rows} key={index} />)}
        </article>
        {slide.notes && <details className="doc-notes" key={slide.page}><summary>演讲者备注</summary><p>{slide.notes}</p></details>}
      </div>}
    </section>
  );
}

function PdfBody({ preview, query, change, busy, url }: PreviewProps<PdfPreview> & { url: string }) {
  const [preferText, setPreferText] = useState(false);
  const inline = navigator.pdfViewerEnabled !== false && preview.inlineAvailable !== false;
  const textOnly = preferText || !inline;
  return (
    <section className="doc-preview" aria-label="PDF 预览" aria-busy={busy}>
      <div className="doc-controls doc-pdf-bar">
        <span className="doc-meta">{preview.totalPages} 页</span>
        {inline && <button type="button" aria-pressed={textOnly}
          onClick={() => setPreferText(value => !value)}>{textOnly ? 'PDF 视图' : '提取文本'}</button>}
        {!inline && <span className="doc-meta">当前展示提取文本</span>}
      </div>
      {textOnly ? (
        <>
          <Pages page={query.startPage ?? 1} total={preview.totalPages} busy={busy} setPage={page => change(pageQuery(page))} />
          <div className="doc-scroll doc-word">
            {preview.pages.map(page => <section key={page.page}>
              <h3>第 {page.page} 页</h3>
              {page.scanLikely && <p className="doc-meta">文本很少，可能是扫描件。可截图后提交视觉识别。</p>}
              {page.text && <p>{page.text}</p>}
            </section>)}
          </div>
        </>
      ) : <iframe className="doc-pdf" src={url} title="PDF 原生预览" onError={() => setPreferText(true)}
        onLoad={event => {
          // Failed same-origin responses are ordinary JSON documents. A native
          // viewer can instead be isolated, so a null document is valid.
          if (event.currentTarget.contentDocument?.contentType === 'application/json') setPreferText(true);
        }} />}
    </section>
  );
}

function ImageBody({ preview, url }: { preview: ImagePreview; url: string }) {
  const [fit, setFit] = useState(true);
  return (
    <section className="doc-preview doc-image" aria-label="图片预览">
      <div className="doc-controls doc-pdf-bar">
        <button aria-pressed={fit} type="button" onClick={() => setFit(value => !value)}>{fit ? '实际尺寸' : '适应窗口'}</button>
      </div>
      <div className={`doc-image-scroll${fit ? ' fitted' : ''}`}><img src={url} alt={preview.path} /></div>
    </section>
  );
}

export default function OfficePreview({ preview, query, change, busy, workspaceId }: PreviewProps<StructuredPreview> & { workspaceId: string }) {
  switch (preview.kind) {
    case 'word': return <WordBody preview={preview} />;
    case 'table': return <TableBody preview={preview} query={query} change={change} busy={busy} />;
    case 'presentation': return <PresentationBody preview={preview} query={query} change={change} busy={busy} />;
    case 'pdf': return <PdfBody preview={preview} query={query} change={change} busy={busy} url={workspaceFileUrl(workspaceId, preview)} />;
    case 'image': return <ImageBody preview={preview} url={workspaceFileUrl(workspaceId, preview)} />;
  }
}
