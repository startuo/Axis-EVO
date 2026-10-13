import { FileCode2 } from "lucide-react";
import { useState } from "react";
import type { FileView, Mode } from "../../lib/types";
import { Badge, CopyButton, EmptyState, Field } from "../ui/Primitives";
export function FilesView({ files, mode }: { files: FileView[]; mode: Mode }) {
  const [index, setIndex] = useState(0);
  const [diff, setDiff] = useState(false);
  const file = files[index] ?? files[0];
  if (!file)
    return (
      <EmptyState title="没有文件观察">此任务尚未记录文件证据。</EmptyState>
    );
  return (
    <section className="file-view">
      <label className="field-label">
        文件观察
        <select
          aria-label="选择文件"
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
        >
          {files.map((f, i) => (
            <option value={i} key={`${f.seq}-${i}`}>
              {f.path} · #{f.seq}
            </option>
          ))}
        </select>
      </label>
      <div className="section-label">
        <FileCode2 size={16} />
        <span className="path-label">{file.path}</span>
        <Badge>{file.reason}</Badge>
      </div>
      <Field label="文件存在" value={file.exists ? "是" : "否"} />
      <Field label="大小（字节）" value={file.sizeBytes} />
      <Field label="SHA-256" value={file.sha256} copy />
      {mode === "demo" && file.content !== undefined ? (
        <>
          <div className="file-toolbar">
            <span>演示快照 · 非 Agent 因果结论</span>
            {file.before !== undefined && (
              <button
                className="text-button"
                onClick={() => setDiff((value) => !value)}
              >
                {diff ? "内容预览" : "对比快照"}
              </button>
            )}
            <CopyButton label="复制演示内容" value={file.content} />
          </div>
          {diff && file.before !== undefined ? (
            <div className="diff-view" aria-label="演示快照对比">
              {file.content.split("\n").map((line, i) => (
                <div
                  key={i}
                  className={
                    file.before!.split("\n")[i] !== line ? "diff-added" : ""
                  }
                >
                  <span>{i + 1}</span>
                  <code>
                    {file.before!.split("\n")[i] !== line ? "+ " : "  "}
                    {line}
                  </code>
                </div>
              ))}
              <p className="caption">
                原行：
                {file.before
                  .split("\n")
                  .find((line, i) => line !== file.content!.split("\n")[i])}
              </p>
            </div>
          ) : (
            <pre className="code-block">{file.content}</pre>
          )}
        </>
      ) : (
        <p className="notice">
          仅提供已持久化的路径、摘要与大小。当前桥接不读取文件内容，也不推断“Agent
          做出的修改”。
        </p>
      )}
    </section>
  );
}
