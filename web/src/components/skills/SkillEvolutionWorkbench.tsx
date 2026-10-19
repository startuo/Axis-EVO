import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, GitBranch, RefreshCw } from 'lucide-react';
import { evolutionApi, generationSource, record, text, validDraft, type EvidencePreview, type EvolutionFact,
  type EvolutionLibrary, type EvolutionReport, type RevisionGeneration } from '../../lib/evolution';
import type { RuntimeProfile, SkillRef } from '../../lib/runtime';
import { Badge, EmptyState, Field, JsonView, Loading } from '../ui/Primitives';
import { ExactEvolutionApproval, RevisionReview } from './RevisionReview';
import { SkillTrustEvidence } from './SkillTrustEvidence';
import '../../styles/skill-evolution.css';

const last = (facts: EvolutionFact[], kind: string) => facts.filter(f => f.kind === kind).at(-1);
const refLabel = (ref: SkillRef) => `${ref.skill_id}@${ref.skill_version}`;
const EvolutionJson = ({ label, value }: { label: string; value: unknown }) =>
  <div className="evolution-json" role="group" aria-label={label} tabIndex={0}><JsonView value={value} /></div>;

export function SkillEvolutionWorkbench({ projectId, token, profiles, onError, onTask }: {
  projectId: string; token: string; profiles: RuntimeProfile[]; onError: (error: unknown) => void;
  onTask: (ref: SkillRef) => void;
}) {
  const [library, setLibrary] = useState<EvolutionLibrary | null>(null);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [preview, setPreview] = useState<{ ref: string; data: EvidencePreview } | null>(null);
  const [caseId, setCaseId] = useState('');
  const [report, setReport] = useState<EvolutionReport | null>(null);
  const [generation, setGeneration] = useState<RevisionGeneration | null>(null);
  const [profileKey, setProfileKey] = useState('');
  const [origin, setOrigin] = useState('USER_REQUESTED');
  const [objective, setObjective] = useState('');
  const [problem, setProblem] = useState('');
  const [selectedRuns, setSelectedRuns] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState('');
  const pending = useRef(false);
  const alive = useRef(true);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    evolutionApi.library(projectId, controller.signal).then(value => {
      if (!controller.signal.aborted) setLibrary(value);
    }).catch(error => { if (!controller.signal.aborted) onError(error); });
    return () => controller.abort();
  }, [projectId, revision, onError]);
  const skill = library?.skills.find(s => refLabel(s.skillRef) === selected) ?? library?.skills[0];
  const sourceKey = skill ? refLabel(skill.skillRef) : '';
  const sourceId = skill?.skillRef.skill_id;
  const sourceVersion = skill?.skillRef.skill_version;
  const evidence = preview?.ref === sourceKey ? preview.data : null;
  useEffect(() => {
    if (!sourceId || !sourceVersion) return;
    const controller = new AbortController();
    evolutionApi.preview(projectId, { skill_id: sourceId, skill_version: sourceVersion }, controller.signal).then(data => {
      if (!controller.signal.aborted) setPreview({ ref: sourceKey, data });
    }).catch(error => { if (!controller.signal.aborted) onError(error); });
    return () => controller.abort();
  }, [projectId, sourceKey, sourceId, sourceVersion, revision, onError]);
  useEffect(() => {
    if (!caseId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const value = await evolutionApi.report(projectId, caseId, controller.signal);
        if (controller.signal.aborted) return;
        setReport(value);
        const intent = last(value.facts, 'GENERATION_INTENT');
        if (intent) {
          const current = await evolutionApi.generation(projectId, intent.id, controller.signal);
          if (!controller.signal.aborted) setGeneration(current);
        }
      } catch (error) { if (!controller.signal.aborted) onError(error); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void read(), 2000); }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId, caseId, revision, onError]);

  async function perform(label: string, path: string[], body: unknown, after?: (fact: EvolutionFact) => void) {
    if (pending.current) return;
    pending.current = true; setBusy(label);
    try {
      const fact = await evolutionApi.mutate(projectId, path, body, token);
      if (alive.current) { after?.(fact); reload(); }
    } catch (error) { if (alive.current) onError(error); }
    finally { pending.current = false; if (alive.current) setBusy(''); }
  }
  const currentReport = report?.case.id === caseId ? report : null;
  const facts = currentReport?.facts ?? [];
  const traceCase = record(currentReport?.case.body.traceSource);
  const traceProposal = facts.filter(f => f.kind === 'TRACE_CANDIDATE' && f.body.stage === 'PROPOSAL').at(-1);
  const traceAuthorization = traceProposal ? facts.find(f => f.kind === 'OP_INTENT' && f.parentId === traceProposal.id && f.body.action === 'trace-candidate-approve') : undefined;
  const currentGeneration = generation?.intent.parentId === caseId ? generation : null;
  const draftFact = last(facts, 'DRAFT');
  const revisionIntent = draftFact ? facts.find(f => f.kind === 'CORE_REVISION_INTENT' && f.parentId === draftFact.id) : undefined;
  const link = revisionIntent ? facts.find(f => f.kind === 'CORE_REVISION_LINK' && f.parentId === revisionIntent.id) : undefined;
  const candidate = last(facts, 'CANDIDATE_RECEIPT') ?? facts.filter(f => f.kind === 'TRACE_CANDIDATE' && f.body.stage === 'RECEIPT').at(-1);
  const candidateAuth = (link ? facts.find(f => f.kind === 'CANDIDATE_AUTH' && f.parentId === link.id) : undefined) ?? traceAuthorization;
  const candidateRef = candidate && record(candidate.body.skillRef) ? candidate.body.skillRef as SkillRef : null;
  const candidateSkill = library?.skills.find(s => candidateRef && refLabel(s.skillRef) === refLabel(candidateRef));
  const operations = facts.filter(f => f.kind === 'OP_RESULT');
  const evaluation = operations.find(f => f.body.action === 'evaluate');
  const evaluationIntent = facts.find(f => f.kind === 'OP_INTENT' && f.body.action === 'evaluate');
  const gate = evaluation && record(evaluation.body.gate) ? evaluation.body.gate : null;
  const promotion = operations.filter(f => f.body.action === 'promotion-proposal').at(-1);
  const promoted = operations.some(f => f.body.action === 'promotion-approve');
  const activation = operations.filter(f => f.body.action === 'activation-proposal').at(-1);
  const activated = !!activation && operations.some(f => f.body.action === 'activation-approve' && f.body.activationId === activation.body.activationId);
  const modelDraft = currentGeneration?.result?.body.draft;
  const rejected = currentGeneration && facts.some(f => f.kind === 'OP_INTENT' && f.parentId === currentGeneration.intent.id && f.body.action === 'reject-suggestion');
  const profile = profiles.find(p => `${p.id}@${p.revision}` === profileKey) ?? profiles[0];
  const caseBody = currentReport?.case.body;
  const generationCard = currentGeneration ? generationSource(currentGeneration) : null;
  const sourceInstructions = generationCard?.instructions ?? '';
  const sourceTools = generationCard?.allowed_tools ?? [];
  const action = (name: string, body: unknown) => void perform(name, ['cases', caseId, 'actions', name], body);
  const filterSkills = library?.skills.filter(s => (filter === 'ALL' || s.state === filter)
    && `${s.name} ${refLabel(s.skillRef)}`.toLowerCase().includes(search.toLowerCase())) ?? [];

  if (!library) return <Loading />;
  return <div className="skill-evolution-workbench runtime-settings-page">
    <div className="runtime-page-heading"><div className="page-eyebrow"><GitBranch size={15} /> 证据驱动 · 明确授权</div>
      <div className="section-heading"><h1>Skills 与演化</h1><button className="icon-button" aria-label="刷新 Skill 演化事实" onClick={reload}><RefreshCw size={16} /></button></div>
      <p>模型提出建议，用户审阅，Core 独立评估。TRUSTED、首选版本与任务成功是不同事实。</p></div>
    {!library.evolutionSchemaAvailable && <p className="notice">此项目尚未由管理员初始化 Core 演化治理；当前只展示注册表，不自动迁移或创建可信版本。</p>}
    <div className="evolution-workbench-grid"><aside className="evolution-library" aria-label="真实 Skill 库">
      <label>搜索 Skill<input value={search} onChange={e => setSearch(e.target.value)} placeholder="名称或精确版本" /></label>
      <label>生命周期筛选<select value={filter} onChange={e => setFilter(e.target.value)}><option value="ALL">全部状态</option>{['CANDIDATE', 'SHADOW', 'TRUSTED'].map(s => <option key={s}>{s}</option>)}</select></label>
      {filterSkills.map(s => <button className={`evolution-skill-row ${sourceKey === refLabel(s.skillRef) ? 'selected' : ''}`} key={refLabel(s.skillRef)}
        onClick={() => { setSelected(refLabel(s.skillRef)); setSelectedRuns([]); }}><strong>{s.name}</strong><small>{refLabel(s.skillRef)}</small><span><Badge>{s.state}</Badge>{s.preferred && <Badge>首选</Badge>}</span></button>)}
      <h2>演化记录</h2>{library.cases.map(c => <button className={`evolution-skill-row ${c.id === caseId ? 'selected' : ''}`} key={c.id}
        onClick={() => { setCaseId(c.id); setSelected(refLabel(c.sourceSkillRef)); setSelectedRuns([]); }}><span>{c.objective}</span><small>{refLabel(c.sourceSkillRef)} · {c.origin}</small></button>)}
    </aside><section className="evolution-detail" aria-label="演化工作区">
      {skill && <section className="evolution-card"><div className="section-heading"><h2><BookOpen size={17} /> {skill.name}</h2><Badge>{skill.state}</Badge></div>
        <Field label="精确版本" value={sourceKey} copy /><Field label="Card SHA-256" value={skill.cardSha256} copy />
        <Field label="生命周期记录数" value={skill.transitionCount} /><Field label="来源" value={JSON.stringify(skill.source)} />
        <div className="tool-tags">{skill.allowedTools.map(t => <code key={t}>{t}</code>)}</div>
        <p>{skill.description}</p>{evidence && <><h3>Instructions</h3><pre className="evolution-instructions" tabIndex={0}>{evidence.sourceCard.instructions}</pre>
          <h3>可验证的历史证据</h3><p className="caption">失败可支持改进请求；不证明 Skill 是原因。UNKNOWN 保持不确定。</p>
          {evidence.integrityIssues.length > 0 && <p role="alert" className="form-error">历史完整性问题阻断新 Case。</p>}
          {evidence.runs.length ? evidence.runs.map(run => <label className="evolution-evidence-row" key={run.run_id}><input type="checkbox" checked={selectedRuns.includes(run.run_id)}
            onChange={e => setSelectedRuns(current => e.target.checked ? [...current, run.run_id] : current.filter(id => id !== run.run_id))} />
            <span>{run.run_id}<small>{run.observed_outcome} · {run.attribution}</small><code>{run.source_evidence_sha256}</code></span></label>) : <p className="caption">尚无历史 Run。可明确提出用户改进请求，不标记为缺陷修复。</p>}
          <Field label="完整历史摘要" value={evidence.evidenceSha256} copy />
          {skill.state === 'TRUSTED' && library.evolutionSchemaAvailable && <form className="evolution-request" onSubmit={event => {
            event.preventDefault(); void perform('create-case', ['cases'], { sourceSkillRef: skill.skillRef,
              sourceCardSha256: skill.cardSha256, evidenceSha256: evidence.evidenceSha256, selectedRunIds: selectedRuns,
              objective, origin, observedProblem: problem, profileId: profile?.id, profileRevision: profile?.revision }, fact => setCaseId(fact.id));
          }}><h3>提出改进</h3><label>改进来源<select value={origin} onChange={e => setOrigin(e.target.value)}><option value="USER_REQUESTED">用户提出新要求</option><option value="EVIDENCE_DRIVEN">基于选定历史证据</option></select></label>
            <label>改进目标<textarea rows={3} value={objective} onChange={e => setObjective(e.target.value)} maxLength={2048} /></label>
            <label>观察与归因限制<textarea rows={2} value={problem} onChange={e => setProblem(e.target.value)} maxLength={2048} /></label>
            <label>修订模型（固定版本）<select value={profile ? `${profile.id}@${profile.revision}` : ''} onChange={e => setProfileKey(e.target.value)}>
              {profiles.map(p => <option key={`${p.id}@${p.revision}`} value={`${p.id}@${p.revision}`}>{p.name} · {p.modelId} · r{p.revision}{p.credentialConfigured ? '' : ' · 未配置凭据'}</option>)}</select></label>
            <button className="button primary" disabled={!!busy || !objective.trim() || !profile?.credentialConfigured || !!evidence.integrityIssues.length || origin === 'EVIDENCE_DRIVEN' && !selectedRuns.length}>建立 Evolution Case</button>
            <button type="button" className="button secondary" disabled={!!busy || !objective.trim() || !profile?.credentialConfigured
              || selectedRuns.length !== 1 || !evidence.runs.some(run => selectedRuns[0] === run.run_id && run.observed_outcome === 'VERIFIED_TASK_SUCCESS')}
              onClick={() => void perform('create-trace-case', ['trace-cases'], { sourceSkillRef: skill.skillRef,
                sourceCardSha256: skill.cardSha256, evidenceSha256: evidence.evidenceSha256, sourceRunId: selectedRuns[0],
                objective, profileId: profile?.id, profileRevision: profile?.revision }, fact => setCaseId(fact.id))}>从选定成功 Run 起草新 Skill</button>
            <p className="caption">Trace-to-Skill 单独创建新 family 的 CANDIDATE/SHADOW；一次成功不证明复用性，不授予 TRUSTED 或任务许可。</p>
          </form>}</>}</section>}
      {currentReport ? <section className="evolution-card" aria-label="当前 Evolution Case">
        <h2>演化工作区</h2><Field label="Web Case" value={caseId} copy /><Field label="改进目标" value={caseBody ? text(caseBody, 'objective') : ''} />
        <Field label="来源" value={caseBody ? text(caseBody, 'origin') : ''} />
        {caseBody && record(caseBody.provider) && <Field label="固定 Provider / Model" value={`${text(caseBody.provider, 'id')} · r${String(caseBody.provider.revision)} · ${text(caseBody.provider, 'modelId')}`} />}
        <p className="notice">归因 INDETERMINATE。Core 引用完整历史 Assessment；用户选定子集只用于修订上下文。Gate v1 对持续多代晋升有限制。</p>
        {!currentGeneration && <button className="button primary" disabled={!!busy} onClick={() => void perform('generate', ['cases', caseId, 'generate'], {}, intent =>
          setGeneration({ intent, result: null, status: 'UNKNOWN', workerActive: false, drafts: [] }))}>调用模型生成修订建议</button>}
        {currentGeneration && <><div className="section-heading"><h3>模型修订调用</h3><Badge>{currentGeneration.status}</Badge></div>
          <Field label="Generation Intent" value={currentGeneration.intent.id} copy /><Field label="Request SHA-256" value={text(currentGeneration.intent.body, 'requestSha256')} copy />
          <Field label="工作进程" value={currentGeneration.workerActive ? '观察到存活进程（瞬时状态）' : '当前未观察到存活进程'} />
          {currentGeneration.result && <Field label="Assistant content SHA-256" value={text(currentGeneration.result.body, 'responseSha256') || '未保留响应内容'} copy />}
          {currentGeneration.status === 'UNKNOWN' && <p role="status" className="notice">Intent 已提交，尚无完整 Result。不能判断模型是否已处理；不会自动重放此调用。</p>}
          {currentGeneration.result && currentGeneration.status !== 'VALID' && <p role="alert" className="form-error">模型调用未产生合法候选建议。无 Run 或工具执行。分类：{text(currentGeneration.result.body, 'errorCategory')}</p>}
          {rejected ? <p className="notice">用户已拒绝此模型建议；没有创建候选。</p> : validDraft(modelDraft) && generationCard && !draftFact && <RevisionReview key={currentGeneration.intent.id} source={sourceInstructions} sourceTools={sourceTools}
            initial={modelDraft} busy={!!busy} onSave={draft => void perform('save-draft', ['generations', currentGeneration.intent.id, 'drafts'], { draft })}
            onReject={() => void perform('reject', ['generations', currentGeneration.intent.id, 'reject'], { reason: 'User explicitly rejected the model suggestion.' })} />}
        </>}
        {draftFact && <section><h3>已保存的用户稿</h3><Field label="Draft SHA-256" value={text(draftFact.body, 'draftSha256')} copy />
          <Field label="稿件来源" value={text(draftFact.body, 'origin')} />
          <details><summary>查看完整已保存草稿</summary><EvolutionJson label="已保存草稿 JSON" value={draftFact.body.draft} /></details>
          {validDraft(draftFact.body.draft) && currentGeneration && <details><summary>继续编辑并保存新的稿件身份</summary><RevisionReview key={draftFact.id}
            source={sourceInstructions} sourceTools={sourceTools} initial={draftFact.body.draft} busy={!!busy}
            onSave={draft => void perform('save-new-draft', ['generations', currentGeneration.intent.id, 'drafts'], { draft })} /></details>}
          {!revisionIntent && (!traceCase || !traceProposal) && <button className="button secondary" disabled={!!busy} onClick={() => void perform('prepare-candidate', ['drafts', draftFact.id, traceCase ? 'prepare-trace' : 'prepare'], {})}>准备精确候选提案</button>}
          {revisionIntent && !link && <p className="notice">Core 桥接尚无完整链接。可能存在部分提交，禁止自动重复创建。</p>}
        </section>}
        {link && !candidateAuth && <ExactEvolutionApproval title="创建候选" digest={text(link.body, 'revisionSha256')} busy={!!busy}
          onApprove={approvedRevisionSha256 => void perform('candidate-approval', ['revisions', link.id, 'approve'], { approvedRevisionSha256 })}>
          <p>仅创建不可变 CANDIDATE；不会自动进入 SHADOW、晋升、激活或执行任务。</p></ExactEvolutionApproval>}
        {traceProposal && !traceAuthorization && <ExactEvolutionApproval title="创建 Trace 候选" digest={traceProposal.sha256} busy={!!busy}
          onApprove={approvedCandidateSha256 => void perform('trace-approval', ['trace-candidates', traceProposal.id, 'approve'], { approvedCandidateSha256 })}>
          <Field label="新 Skill ID / 完整 Card" value={JSON.stringify(traceProposal.body.card)} />
          <Field label="源成功 Run" value={text(traceProposal.body, 'sourceRunId')} copy />
          <p>源 Run 只证明其独立验收成功；此提案仅授权创建新的 CANDIDATE，不授权晋升或使用。</p></ExactEvolutionApproval>}
        {candidateAuth && !candidate && <p className="notice">候选创建已授权，但 Web 尚无完整 Receipt。不得重放；需核对 Core 事实。</p>}
        {candidate && candidateRef && <><h3>候选版本 · {refLabel(candidateRef)}</h3><Field label="候选 Card SHA-256" value={text(candidate.body, 'cardSha256')} copy />
          <Field label="当前生命周期" value={candidateSkill?.state ?? '未重新核验'} />
          {candidateSkill?.state === 'CANDIDATE' && <ExactEvolutionApproval title="进入 SHADOW" digest={text(candidate.body, 'cardSha256')} busy={!!busy}
            onApprove={approvedCardSha256 => action('shadow', { candidateReceiptId: candidate.id, approvedCardSha256 })} />}
          {candidateSkill?.state === 'SHADOW' && !evaluationIntent && <><p>对后台配置的封闭套件进行配对评估，最多十次模型调用；隐藏 Oracle 不发给模型。不是生产执行或论文正式实验。</p>
            <button className="button primary" disabled={!!busy} onClick={() => void perform('evaluate', ['cases', caseId, 'evaluate'], { candidateReceiptId: candidate.id })}>开始配对 Shadow 评估</button></>}
          {evaluationIntent && !evaluation && <p className="notice">评估 Intent 已提交，完整结果尚未记录。现有 trial 不丢弃、不覆盖或自动重试。</p>}
          {evaluation && <><h3>独立评估与 Gate</h3><Field label="Trust Assessment" value={text(evaluation.body, 'assessmentId')} copy />
            <Field label="建议（不是授权）" value={text(evaluation.body, 'recommendation')} />
            <SkillTrustEvidence reference={caseBody && record(caseBody.sourceSkillRef) ? caseBody.sourceSkillRef as SkillRef : null}
              candidate={candidateRef} metrics={evaluation.body.metrics} outcomes={evaluation.body.outcomes}
              gate={gate} assessmentSha256={text(evaluation.body, 'assessmentSha256')} />
            {gate?.eligible === false && <p role="alert" className="form-error">Gate 阻断晋升。回归、缺失或不兼容证据不能通过重试筛除。</p>}
            {gate?.eligible === true && !promotion && <button className="button primary" disabled={!!busy} onClick={() => action('promotion-proposal', { candidateReceiptId: candidate.id, assessmentId: evaluation.body.assessmentId })}>准备晋升提案</button>}</>}
          {promotion && !promoted && <ExactEvolutionApproval title="晋升为 TRUSTED" digest={text(promotion.body, 'proposalSha256')} busy={!!busy}
            onApprove={approvedPromotionSha256 => action('promotion-approve', { proposalId: promotion.body.proposalId, approvedPromotionSha256 })}>
            <p>Core 会重新核验全部 Gate 证据。此操作不会自动更改首选版本。</p></ExactEvolutionApproval>}
          {promoted && <section><h3>TRUSTED 晋升已记录</h3><p>只证明此封闭 Gate 和明确批准通过，不证明通用改进或模型内部遵循了 Skill。</p>
            {(!activation || activated && !candidateSkill?.preferred) && <button className="button secondary" disabled={!!busy} onClick={() => action('activation-proposal', { skillRef: candidateRef,
              expectedPreviousEventId: candidateSkill?.activationHeadId ?? null, reason: 'User explicitly selects the evaluated candidate for future tasks.' })}>准备首选版本激活</button>}
            {activation && !activated && <ExactEvolutionApproval title="激活首选版本" digest={text(activation.body, 'proposalSha256')} busy={!!busy}
              onApprove={approvedActivationSha256 => action('activation-approve', { activationId: activation.body.activationId, approvedActivationSha256 })}>
              <Field label="待激活精确版本" value={record(activation.body.proposal) ? `${text(activation.body.proposal, 'skill_id')}@${String(activation.body.proposal.skill_version)}` : '未核验'} />
              <p>这是独立路由授权，既有版本、Runs 与原批准均不改写。</p></ExactEvolutionApproval>}
            {candidateSkill?.preferred && <><p className="notice">此精确版本已设为首选，历史 Run 不变。</p>
              <button className="button primary" disabled={!library.allowEvolvedSkills} onClick={() => onTask(candidateRef)}>用此精确版本创建新任务</button>
              {caseBody && record(caseBody.sourceSkillRef) && (!activation || activated) && <button className="button secondary" disabled={!!busy}
                onClick={() => action('activation-proposal', { skillRef: caseBody.sourceSkillRef,
                  expectedPreviousEventId: candidateSkill.activationHeadId, reason: 'User explicitly requests routing rollback to the original TRUSTED source.' })}>选择原 TRUSTED 版本（路由回退）</button>}
              {!library.allowEvolvedSkills && <p className="caption">管理员尚未开启 allow_evolved_skills；激活不会扩大静态任务许可。</p>}</>}
          </section>}
        </>}
        <details><summary>查看审计记录（不默认重复原始请求/响应）</summary><EvolutionJson label="审计记录 JSON" value={currentReport} /></details>
      </section> : <EmptyState title="选择或创建 Evolution Case">从左侧选择已记录 Case，或以精确 TRUSTED 版本提出改进。</EmptyState>}
      {!!busy && <p role="status" className="caption">正在提交 {busy}；网络失败不代表已回滚，请读取事实确认。</p>}
    </section></div>
  </div>;
}
