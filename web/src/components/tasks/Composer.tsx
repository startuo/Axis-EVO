import { ArrowUp, CornerDownLeft, Paperclip } from "lucide-react";
import { useState } from "react";
export function Composer({
  scope,
  notify,
  visible = true,
}: {
  scope: string;
  notify: (message: string) => void;
  visible?: boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const value = drafts[scope] ?? "";
  function save() {
    if (value.trim())
      notify("草稿已保留在当前会话；未调用模型或工具。刷新后清除。");
  }
  return (
    <section
      hidden={!visible}
      className="composer-area"
      aria-label="草稿编辑区"
    >
      <div className="composer-box">
        <textarea
          aria-label="任务草稿"
          placeholder="描述你想完成的工作…"
          rows={3}
          value={value}
          maxLength={12000}
          onChange={(e) => setDrafts({ ...drafts, [scope]: e.target.value })}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
        />
        <div className="composer-toolbar">
          <span>
            <button
              className="icon-button"
              disabled
              aria-label="附加上下文（尚未开放）"
              title="当前不支持上传或读取主机文件"
            >
              <Paperclip size={17} />
            </button>
            <span className="composer-mode">草稿模式</span>
          </span>
          <button
            className="send-button"
            aria-label="保存草稿"
            disabled={!value.trim()}
            onClick={save}
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
      <div className="composer-caption">
        <span>仅编辑草稿 · 不发送模型请求，不执行工具</span>
        <span>
          <CornerDownLeft size={11} /> Ctrl / ⌘ + Enter
        </span>
      </div>
    </section>
  );
}
