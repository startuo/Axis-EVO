import { BookOpen, GitBranch, Shield, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import type { SkillView } from "../../lib/types";
import {
  Badge,
  EmptyState,
  Field,
  JsonView,
  Loading,
  runTone,
} from "../ui/Primitives";
export function SkillsView({
  skills,
  read,
  navigate,
  caseId,
}: {
  skills: SkillView[];
  read: (
    id: string,
    version: number,
    signal: AbortSignal,
  ) => Promise<SkillView>;
  navigate: (path: string) => void;
  caseId?: string;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillView | null>(null);
  const [error, setError] = useState(false);
  const filtered = skills.filter((s) =>
    `${s.name} ${s.id} ${s.state}`.toLowerCase().includes(search.toLowerCase()),
  );
  const current =
    skills.find((s) => `${s.id}@${s.version}` === selected) ?? filtered[0];
  const id = current?.id;
  const version = current?.version;
  useEffect(() => {
    if (!id || version === undefined) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setError(false);
    read(id, version, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setDetail(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [id, version, read]);
  return (
    <div className="page skills-page">
      <div className="page-eyebrow">
        <BookOpen size={15} /> 不可变技能注册表
      </div>
      <h1>Skills</h1>
      <p className="page-description">
        每个执行记录绑定精确版本。TRUSTED 是准入状态，不是结果保证。
      </p>
      <input
        className="wide-search"
        aria-label="搜索 Skill"
        placeholder="搜索名称、Skill ID 或生命周期…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {!filtered.length ? (
        <EmptyState title="没有匹配的 Skill 版本">
          更换搜索条件，或检查当前项目的数据源。
        </EmptyState>
      ) : (
        <div className="skills-split">
          <div className="skill-list" aria-label="Skill 版本列表">
            {filtered.map((skill) => (
              <button
                className={`skill-row ${current === skill ? "active" : ""}`}
                key={`${skill.id}-${skill.version}`}
                onClick={() => setSelected(`${skill.id}@${skill.version}`)}
              >
                <span className="skill-row-top">
                  <strong>{skill.name}</strong>
                  <span>v{skill.version}</span>
                </span>
                <span className="caption">{skill.id}</span>
                <span className="skill-row-bottom">
                  <Badge tone={runTone(skill.state)}>{skill.state}</Badge>
                  {skill.preferred && (
                    <span className="preferred-label">首选版本</span>
                  )}
                </span>
              </button>
            ))}
          </div>
          <section className="skill-detail">
            {error ? (
              <EmptyState title="此版本暂时无法核验">
                未用其他版本替代，请检查只读数据源。
              </EmptyState>
            ) : !detail ? (
              <Loading />
            ) : (
              <>
                <div className="section-heading">
                  <h2>{detail.name}</h2>
                  <label className="version-label">
                    版本
                    <select
                      aria-label="选择 Skill 版本"
                      value={detail.version}
                      onChange={(e) =>
                        setSelected(`${detail.id}@${e.target.value}`)
                      }
                    >
                      {skills
                        .filter((s) => s.id === detail.id)
                        .map((s) => (
                          <option key={s.version} value={s.version}>
                            v{s.version} · {s.state}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <Field
                  label="精确 SkillRef"
                  value={`${detail.id}@${detail.version}`}
                  copy
                />
                <Field
                  label="生命周期"
                  value={
                    <Badge tone={runTone(detail.state)}>{detail.state}</Badge>
                  }
                />
                <p>{detail.description}</p>
                <h3>
                  <BookOpen size={15} /> Instructions
                </h3>
                <p className="instructions">
                  {detail.instructions ?? "此数据源未提供指令预览。"}
                </p>
                <h3>允许的工具</h3>
                <div className="tool-tags">
                  {detail.allowedTools.map((tool) => (
                    <code key={tool}>{tool}</code>
                  ))}
                </div>
                <h3>
                  <GitBranch size={15} /> 来源与历史
                </h3>
                <JsonView value={detail.source} />
                {detail.history && (
                  <details>
                    <summary>查看生命周期记录</summary>
                    <JsonView value={detail.history} />
                  </details>
                )}
                <Field label="Card SHA-256" value={detail.cardSha256} copy />
                <h3>
                  <Shield size={15} /> Trust Assessment
                </h3>
                {detail.trust ? (
                  <JsonView value={detail.trust} />
                ) : (
                  <p className="caption">没有可用的评估证据。</p>
                )}
                <p className="caption">
                  评估建议 ≠ 晋升资格 ≠ 批准 ≠ TRUSTED 收据 ≠ 版本激活。
                </p>
                {caseId && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      navigate(`/evolution/${encodeURIComponent(caseId)}`)
                    }
                  >
                    <Workflow size={15} /> 查看演化证据
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
