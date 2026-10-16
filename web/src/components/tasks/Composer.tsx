import { ArrowUp, BookOpen, ChevronDown, FolderOpen } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { PopoverSelect, type SelectOption } from "../ui/PopoverSelect";

type DraftSelection = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
};

export function Composer({
  scope,
  notify,
  visible = true,
  workspaceName,
  profileName,
  projectSelection,
  profileSelection,
  skillSelection,
  status,
  statusAction,
}: {
  scope: string;
  notify: (message: string) => void;
  visible?: boolean;
  workspaceName?: string;
  profileName?: string;
  projectSelection?: DraftSelection;
  profileSelection?: DraftSelection;
  skillSelection?: DraftSelection;
  status?: string;
  statusAction?: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const value = drafts[scope] ?? "";

  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element || !visible) return;
    element.style.height = "0px";
    element.style.height = `${Math.max(42, Math.min(384, element.scrollHeight))}px`;
    element.style.overflowY = element.scrollHeight > 384 ? "auto" : "hidden";
  }, [value, visible]);

  function save() {
    if (value.trim()) notify("草稿已保留在当前会话；未调用模型或工具。刷新后清除。");
  }

  return (
    <section hidden={!visible} className="composer-area cds-composer" aria-label="草稿编辑区">
      <div className="composer-box cds-composer-box">
        <textarea
          ref={textarea}
          aria-label="任务草稿"
          placeholder="描述你想完成的工作…"
          rows={2}
          value={value}
          maxLength={12000}
          onChange={(event) => setDrafts((current) => ({ ...current, [scope]: event.target.value }))}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (!event.shiftKey || event.ctrlKey || event.metaKey) && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault();
              save();
            }
          }}
        />
        <div className="composer-toolbar cds-composer-toolbar">
          <div className="cds-composer-controls">
            {projectSelection ? (
              <PopoverSelect label="选择项目" {...projectSelection} placeholder="选择项目" icon={<FolderOpen size={14} />} />
            ) : workspaceName ? (
              <span className="cds-composer-context" title={workspaceName}>工作区 · {workspaceName}</span>
            ) : null}
            {profileSelection ? (
              <PopoverSelect label="模型配置草稿" {...profileSelection} placeholder="配置草稿" />
            ) : (
              <span className="cds-composer-context" title={profileName}>配置草稿 · {profileName ?? "未选择"}<ChevronDown size={12} /></span>
            )}
            {skillSelection && <PopoverSelect label="Skill 草稿" {...skillSelection} placeholder="Skill" icon={<BookOpen size={14} />} />}
          </div>
          <button type="button" className="send-button cds-send" aria-label="保存草稿" title="保存草稿" disabled={!value.trim()} onClick={save}>
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
      <div className="composer-caption cds-composer-caption">
        <span><span className="cds-draft-badge">草稿</span>仅编辑草稿 · 不发送模型请求，不执行工具</span>
        <span>Enter 保存 · Shift + Enter 换行</span>
      </div>
      {status && <div className="cds-composer-status"><span>{status}</span>{statusAction && <button type="button" className="text-button" onClick={statusAction}>重新检查连接</button>}</div>}
    </section>
  );
}
