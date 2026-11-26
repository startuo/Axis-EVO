/** Runtime-specific settings for workspaces, models and local preferences. */
import { useState } from 'react';
import type { Profile } from '@axis/protocol';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BookOpen, Compass, FolderLock, Plug, Server, Shield, SlidersHorizontal, Sparkles, Terminal,
  type LucideIcon,
} from 'lucide-react';
import { Skeleton } from '../../components/ui';
import { fadeUp, motionProps } from '../../lib/motion';
import { EvolutionSection } from './sections/EvolutionSection';
import { GuideSection } from './sections/GuideSection';
import { McpSection } from './sections/McpSection';
import { PermissionsSection, WorkspacePermissionsSection } from './sections/PermissionsSection';
import { PreferencesSection } from './sections/PreferencesSection';
import { ProfilesSection } from './sections/ProfilesSection';
import { WorkspaceSection } from './sections/WorkspaceSection';
import { WorkspaceExecutionSection } from './sections/WorkspaceExecutionSection';
import { WorkspaceSourcesSection } from './sections/WorkspaceSourcesSection';
import { useSettingsData } from './useSettingsData';
import './settings.css';

type SectionId = 'guide' | 'workspace' | 'sources' | 'execution' | 'profiles' | 'mcp' | 'permissions' | 'evolution' | 'preferences';

const NAV: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: 'guide', label: '引导', icon: Compass },
  { id: 'workspace', label: '工作区', icon: FolderLock },
  { id: 'sources', label: '资料来源', icon: BookOpen },
  { id: 'execution', label: '项目命令与验证', icon: Terminal },
  { id: 'profiles', label: '模型连接', icon: Plug },
  { id: 'mcp', label: 'MCP 服务器', icon: Server },
  { id: 'permissions', label: '权限', icon: Shield },
  { id: 'evolution', label: 'Skill 进化策略', icon: Sparkles },
  { id: 'preferences', label: '偏好', icon: SlidersHorizontal },
];

export function SettingsView({ profiles, section, onNavigateSection }: {
  profiles: Profile[];
  section?: string;
  onNavigateSection?: (section: SectionId) => void;
}) {
  const { loading, error, retry, workspaces, settings, updateSettings, refreshSettings, request,
    pythonRuntime, providerCatalog } = useSettingsData();
  const [standaloneSection, setStandaloneSection] = useState<SectionId>();
  const reduce = useReducedMotion();
  const showMcp = import.meta.env.MODE === 'test' && !pythonRuntime;

  const availableNav = NAV.filter((item) => (item.id !== 'mcp' || showMcp)
    && (!['sources', 'execution'].includes(item.id) || pythonRuntime));
  const selected = section ?? standaloneSection;
  const active = availableNav.find((item) => item.id === selected)?.id
    ?? (!loading && workspaces.length === 0 && profiles.length === 0 ? 'guide' : 'workspace');

  const navigate = (id: string) => {
    const next = availableNav.find((item) => item.id === id)?.id;
    if (!next) return;
    if (onNavigateSection) onNavigateSection(next);
    else setStandaloneSection(next);
  };

  const startChat = () => { window.location.hash = '#/chat'; };

  return (
    <div data-view="settings" className="settings-view">
      <header className="settings-head">
        <h1 className="settings-title">设置</h1>
      </header>
      <div className="settings-body">
        <nav className="settings-nav" aria-label="设置导航">
          {availableNav.map((item) => {
            const Icon = item.icon;
            const selected = active === item.id;
            return (
              <button
                key={item.id}
                className={`settings-nav-btn${selected ? ' selected' : ''}`}
                aria-current={selected ? 'page' : undefined}
                onClick={() => navigate(item.id)}
              >
                <Icon size={16} strokeWidth={1.7} aria-hidden />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="settings-content">
          {loading ? (
            <div className="settings-loading" role="status" aria-label="加载设置">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : error ? (
            <div className="set-section" role="alert">
              <p>无法加载设置。请确认本机 Axis-Evo 服务已启动。</p>
              <div><button className="button" onClick={retry}>重新加载</button></div>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div key={active} {...motionProps(reduce, fadeUp)}>
                {active === 'guide' && <GuideSection workspaces={workspaces} profiles={profiles}
                  onNavigate={navigate} onStart={startChat} pythonRuntime={pythonRuntime} />}
                {active === 'workspace' && <WorkspaceSection workspaces={workspaces} request={request} pythonRuntime={pythonRuntime} />}
                {active === 'sources' && pythonRuntime && <WorkspaceSourcesSection workspaces={workspaces} request={request} />}
                {active === 'execution' && pythonRuntime && <WorkspaceExecutionSection workspaces={workspaces} request={request} />}
                {active === 'profiles' && <ProfilesSection profiles={profiles} request={request}
                  catalog={providerCatalog} pythonRuntime={pythonRuntime} />}
                {active === 'mcp' && showMcp && <McpSection />}
                {active === 'permissions' && (pythonRuntime
                  ? <WorkspacePermissionsSection workspaces={workspaces} request={request} />
                  : <PermissionsSection settings={settings} updateSettings={updateSettings} />)}
                {active === 'evolution' && <EvolutionSection settings={settings} refreshSettings={refreshSettings}
                  request={request} pythonWorkspaces={pythonRuntime ? workspaces : undefined} />}
                {active === 'preferences' && <PreferencesSection settings={settings} updateSettings={updateSettings}
                  pythonRuntime={pythonRuntime} />}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}

export default SettingsView;
