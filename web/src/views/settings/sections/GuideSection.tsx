/** 引导：首次运行三步（授权工作区 → 连接模型 → 开始），状态由真实数据推导。 */
import { ArrowRight, Check, Compass, FolderLock, Plug, Rocket } from 'lucide-react';
import type { Profile, Workspace } from '@axis/protocol';
import { SectionHeader } from '../ui';

export interface GuideSectionProps {
  workspaces: Workspace[];
  profiles: Profile[];
  onNavigate: (section: string) => void;
  onStart: () => void;
  pythonRuntime?: boolean;
}

export function GuideSection({ workspaces, profiles, onNavigate, onStart, pythonRuntime = false }: GuideSectionProps) {
  const wsDone = workspaces.length > 0;
  const modelDone = profiles.some((p) => p.credentialConfigured);
  const tested = profiles.some((p) => p.credentialConfigured && p.testStatus === 'CONNECTED');
  const allDone = wsDone && modelDone;
  const doneCount = (wsDone ? 1 : 0) + (modelDone ? 1 : 0);

  const steps = [
    {
      key: 'workspace', icon: FolderLock, title: '授权工作区', done: wsDone,
      desc: wsDone ? `已授权 ${workspaces.length} 个工作区。` : '授权一个目录，代理才能读写其中的文件。',
      action: wsDone ? '管理工作区' : '去授权', target: 'workspace',
    },
    {
      key: 'profiles', icon: Plug, title: '连接模型', done: modelDone,
      desc: modelDone
        ? pythonRuntime ? tested ? '已有模型通过连接测试。' : '已配置模型凭据。可以在模型连接中测试端点。' : '已配置可用的模型连接。'
        : '添加模型端点，并在环境变量中设置凭据密钥。',
      action: modelDone ? '管理连接' : '去连接', target: 'profiles',
    },
    {
      key: 'start', icon: Rocket, title: '开始对话', done: allDone,
      desc: allDone ? '一切就绪，开始你的第一个任务。' : '完成前两步后即可开始。',
      action: '开始对话', target: 'start',
    },
  ];

  return (
    <section className="set-section" aria-label="引导">
      <SectionHeader icon={Compass} title="引导" description="三步完成首次配置。状态随你的配置实时更新。" />

      <div className="set-guide-progress" aria-label="配置进度">
        <div className="set-guide-bar"><div className="set-guide-fill" style={{ width: `${(doneCount / 2) * 100}%` }} /></div>
        <span className="set-guide-count">{doneCount} / 2 已完成</span>
      </div>

      <ol className="set-guide">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const isStart = step.target === 'start';
          return (
            <li key={step.key} className={`set-guide-step${step.done ? ' done' : ''}`}>
              <span className="set-guide-marker" aria-hidden>
                {step.done ? <Check size={16} /> : <span>{i + 1}</span>}
              </span>
              <div className="set-guide-body">
                <div className="set-guide-title"><Icon size={15} aria-hidden /> {step.title}</div>
                <p className="set-guide-desc">{step.desc}</p>
              </div>
              <button
                className={isStart ? 'button primary' : 'button'}
                disabled={isStart && !allDone}
                onClick={() => (isStart ? onStart() : onNavigate(step.target))}
              >
                {step.action} <ArrowRight size={14} aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>
      {pythonRuntime && (
        <div><a className="button" href="#/research-demo">毕业设计只读展示 <ArrowRight size={14} aria-hidden /></a></div>
      )}
    </section>
  );
}
