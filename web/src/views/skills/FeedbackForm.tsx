/**
 * Skill feedback form (skills-mcp stream): rating + comment + deterministic
 * checks, bound to a real session. Submits skill.feedback; the evolution
 * cycle then appears live in the timeline via evolution.updated events.
 */
import { useEffect, useState } from 'react';
import { LoaderCircle, Plus, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import type { Session, Skill, SkillCheck } from '@axis/protocol';
import { useSocket } from '../../hooks/useSocket';

export interface FeedbackFormProps {
  skill: Skill;
  onSubmitted?: (evolutionId: string) => void;
}

const CHECK_KINDS: Array<{ value: SkillCheck['kind']; label: string }> = [
  { value: 'contains', label: '包含文本 contains' },
  { value: 'not_contains', label: '不含文本 not_contains' },
  { value: 'heading', label: '标题 heading' },
  { value: 'command-exit-zero', label: '命令退出码为 0' },
];
const availableChecks = CHECK_KINDS.filter(check =>
  import.meta.env.MODE === 'test' || check.value !== 'command-exit-zero');

export function FeedbackForm({ skill, onSubmitted }: FeedbackFormProps) {
  const { request } = useSocket();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [rating, setRating] = useState<'positive' | 'negative' | null>(null);
  const [comment, setComment] = useState('');
  const [checks, setChecks] = useState<SkillCheck[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void request<{ sessions?: Session[] } | Session[]>('session.list', { limit: 30 })
      .then((result) => {
        if (cancelled) return;
        const list = Array.isArray(result) ? result : (result.sessions ?? []);
        setSessions(list);
        setSessionId((cur) => cur || list[0]?.id || '');
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [request]);

  const submit = async () => {
    setError(null);
    setDone(null);
    if (!rating) { setError('请先选择 👍 或 👎 评价。'); return; }
    if (!sessionId) { setError('请选择反馈绑定的会话（该技能实际使用过的会话）。'); return; }
    if (checks.some(c => !c.value.trim())) { setError('检查项的值不能为空。'); return; }
    setSubmitting(true);
    try {
      const cycle = await request<{ id: string }>('skill.feedback', {
        skillId: skill.id, sessionId, rating, comment, checks,
      });
      setDone(rating === 'negative'
        ? '已提交。负反馈将触发一次进化周期：独立上下文生成候选 → 隔离 A/B → 确定性检查重算 → 策略判定。'
        : '已提交。正向反馈会按确定性检查确认当前版本。');
      setComment('');
      setChecks([]);
      setRating(null);
      onSubmitted?.(cycle.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sk-feedback" data-form="feedback">
      <div className="sk-section-title">反馈与进化</div>
      <div className="sk-feedback-row">
        <div className="sk-rating-group" role="group" aria-label="评价">
          <button className="sk-rating-btn positive" aria-pressed={rating === 'positive'} onClick={() => setRating('positive')}>
            <ThumbsUp size={14} aria-hidden /> 有帮助
          </button>
          <button className="sk-rating-btn negative" aria-pressed={rating === 'negative'} onClick={() => setRating('negative')}>
            <ThumbsDown size={14} aria-hidden /> 有问题
          </button>
        </div>
        <label className="sk-field">
          <span className="sk-field-label">绑定会话</span>
          <select className="sk-select" value={sessionId} onChange={e => setSessionId(e.target.value)} aria-label="绑定会话">
            {sessions.length === 0 && <option value="">暂无会话</option>}
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.title || s.id}，{new Date(s.updatedAt).toLocaleString()}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="sk-field">
        <span className="sk-field-label">评论（会进入候选生成的独立上下文）</span>
        <textarea className="sk-textarea" value={comment} onChange={e => setComment(e.target.value)} placeholder="例如：报告里的结果标签写错了，应该是 Alpha…" />
      </label>

      <div className="sk-check-editor">
        <span className="sk-field-label">确定性检查（宿主从真实字节重算，模型无法篡改）</span>
        {checks.map((check, index) => (
          <div className="sk-check-edit-row" key={index}>
            <select
              className="sk-select"
              value={check.kind}
              aria-label={`检查 ${index + 1} 类型`}
              onChange={e => setChecks(list => list.map((c, i) => (i === index ? { ...c, kind: e.target.value as SkillCheck['kind'] } : c)))}
            >
              {availableChecks.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <input
              className="sk-input"
              value={check.value}
              aria-label={`检查 ${index + 1} 值`}
              placeholder={check.kind === 'command-exit-zero' ? '命令子串，例如 npm test' : '例如 Alpha result'}
              onChange={e => setChecks(list => list.map((c, i) => (i === index ? { ...c, value: e.target.value } : c)))}
            />
            <button className="icon-button" aria-label={`删除检查 ${index + 1}`} onClick={() => setChecks(list => list.filter((_, i) => i !== index))}>
              <Trash2 size={13} aria-hidden />
            </button>
          </div>
        ))}
        <button className="text-button" style={{ alignSelf: 'flex-start' }} onClick={() => setChecks(list => [...list, { kind: 'contains', value: '' }])}>
          <Plus size={13} aria-hidden /> 添加检查
        </button>
      </div>

      {error && <div className="sk-form-error" role="alert">{error}</div>}
      {done && <div className="sk-form-note" role="status">{done}</div>}

      <div className="sk-feedback-row">
        <button className="button primary" disabled={submitting} onClick={() => void submit()}>
          {submitting && <LoaderCircle size={14} className="spin" aria-hidden />} 提交反馈
        </button>
        <span className="sk-form-note">负反馈 + observe/auto 策略 → 生成候选并隔离 A/B；auto 仅在全部检查通过且有改善、无退步、评审无反对时采用。</span>
      </div>
    </div>
  );
}

export default FeedbackForm;
