import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, FileCheck2, GitBranch, LockKeyhole } from 'lucide-react';
import '../../styles/research-archive.css';

const freeze = '12c789b187a6bf8332b8d5222d00cc0702d4bdc8';
const base = 'https://github.com/startuo/Axis-EVO/blob/academic/thesis-freeze-2026-11-02/docs/';
const versions = [
  { name: 'S0', ref: 'meeting-minutes.github-pilot@1', state: '隔离 TRUSTED 基线', sha: '9177f38597decdc581dfda5324622b53646d5efba25b2a7085d8769bedccaf9f', note: '经获批的研究生命周期准入。这个历史状态不授予当前产品权限，也不等于已证明语义质量可靠。' },
  { name: 'S1', ref: 'meeting-minutes.github-pilot@2', state: 'SHADOW（未生产采用）', sha: '3bdb6e70d5ec5dc97c5a005a706af1bebf2d5afe19f9e276f451d0594ffd0e34', note: '由所有者确认的反馈驱动，派生自精确 S0。唯一修订响应原样保留，没有在 Gate 之后手工修补。内容评价混合，研究条件 C 仍选择 S0。' },
];

export function ResearchArchive({ navigate }: { navigate: (path: string) => void }) {
  const [selected, setSelected] = useState(1);
  const version = versions[selected];
  return <main className="research-archive">
    <header><button className="text-button" onClick={() => navigate('/agent')}><ArrowLeft size={16}/>返回 Axis</button><span><LockKeyhole size={14}/>冻结资料，供只读查阅</span></header>
    <section className="research-intro"><p className="agent-eyebrow">AXIS / RESEARCH ARCHIVE</p><h1>一次演化，<br/>三层证据。</h1><p>《基于大语言模型的技能演化系统的设计与实现》</p><p>从执行事实到内容评价，再到版本治理。此页摘录已公开的冻结记录；当前产品从 main 独立发展。</p><a href={`${base}TEST_RESULTS.md`} target="_blank" rel="noreferrer">核对冻结记录<ArrowUpRight size={15}/></a></section>
    <section className="research-finding"><FileCheck2 size={24}/><div><h2>记录了演化过程，尚未证明整体质量改善。</h2><p>Core Gate 给出 ELIGIBLE_FOR_APPROVAL；内容评价呈混合结果。S1 保持 SHADOW，未进行生产晋升或激活。</p></div></section>
    <section className="research-counts" aria-label="历史 Pilot 的不同证据口径"><div><strong>1</strong><span>真实文件 Development Run</span></div><div><strong>26</strong><span>真实模型生成的文件模拟 Trial</span></div><div><strong>5</strong><span>超时，远端计算与费用未确认</span></div></section>
    <section className="research-columns"><div><p className="agent-eyebrow">01 / LINEAGE</p><h2>版本关系</h2><div className="research-version-tabs" role="tablist" aria-label="Skill 版本">{versions.map((v, index) => <button key={v.name} role="tab" id={`research-tab-${index}`} aria-selected={selected === index} tabIndex={selected === index ? 0 : -1} aria-controls="research-version" onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? versions.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + versions.length) % versions.length;
      setSelected(next);
      document.getElementById(`research-tab-${next}`)?.focus();
    }} onClick={() => setSelected(index)}>{v.name}{index === 0 && <GitBranch size={16}/>}</button>)}</div><article role="tabpanel" id="research-version" aria-labelledby={`research-tab-${selected}`}><h3>{version.state}</h3><code>{version.ref}</code><p>{version.note}</p><details><summary>固定 Card SHA-256</summary><code>{version.sha}</code></details></article></div>
    <div><p className="agent-eyebrow">02 / EXECUTION</p><h2>执行事实与未知结果</h2><ol className="research-flow"><li><strong>批准计划</strong><span>精确计划摘要与允许的工具范围</span></li><li><strong>Intent → 工具 → Result</strong><span>记录派发与工具回执，独立检查文件字节</span></li><li><strong>UNKNOWN 停止</strong><span>中断后的未知副作用不自动重放；模型宣称成功不等于工具完成</span></li></ol><small>机制示意；不是新增运行日志。真实文件 Run 与文件模拟 Trial 分开统计。</small></div></section>
    <section className="research-limits"><p className="agent-eyebrow">03 / INTERPRETATION</p><h2>结论保持原来的边界</h2><dl><div><dt>执行层</dt><dd>文件生成、事件关联与字节核验有工程证据；不能据此认定内容正确。</dd></div><div><dt>评价层</dt><dd>来源位置校验不能自动识别语义错误。原始 LLM 评价与反例保留，未由本页重新评分。</dd></div><div><dt>研究准入</dt><dd>HUMAN_CALIBRATION=PENDING；实际人类记录为 0。Final Holdout 未冻结、未运行。冻结版本中的论文主实验实测为 0 次。后续阶段的五状态与 54 次主实验不计入此冻结版本的实测。</dd></div></dl><p>私有研究材料不随公开产品分发。此页不读取运行数据库，不发起实验，也不修改历史身份。</p></section>
    <footer><code>{freeze}</code><nav aria-label="冻结研究文档"><a href={`${base}MEETING_MINUTES_PILOT_V2.md`} target="_blank" rel="noreferrer">Pilot 协议</a><a href={`${base}STAGE2D_RESEARCH_PROTOCOL.md`} target="_blank" rel="noreferrer">评价与反例</a><a href={`${base}STAGE2E_CALIBRATION.md`} target="_blank" rel="noreferrer">校准边界</a></nav></footer>
  </main>;
}
