/** 外观偏好与运行限额。 */
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, SlidersHorizontal } from 'lucide-react';
import type { Settings } from '@axis/protocol';
import { useToast } from '../../../components/Toasts';
import { errorMessage } from '../../../lib/format';
import { Field, SectionHeader, TextInput } from '../ui';
import { AppearanceControls } from './AppearanceControls';

export interface PreferencesSectionProps {
  settings: Settings | null;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  pythonRuntime?: boolean;
}

export function PreferencesSection({ settings, updateSettings, pythonRuntime = false }: PreferencesSectionProps) {
  const toast = useToast();
  const [maxTurnSeconds, setMaxTurnSeconds] = useState(settings?.maxTurnSeconds ?? 900);
  const [maxToolCalls, setMaxToolCalls] = useState(settings?.maxToolCalls ?? 120);
  const [busy, setBusy] = useState(false);

  // Seed the drafts once when settings first load — but never overwrite an edit
  // the user already made (settings can arrive after the first keystroke).
  const seeded = useRef(false);
  const touched = useRef(false);
  useEffect(() => {
    if (settings && !seeded.current && !touched.current) {
      setMaxTurnSeconds(settings.maxTurnSeconds);
      setMaxToolCalls(settings.maxToolCalls);
      seeded.current = true;
    }
  }, [settings]);

  const saveLimits = async () => {
    if (busy) return;
    if (!Number.isInteger(maxTurnSeconds) || maxTurnSeconds < 30 || maxTurnSeconds > 3600) {
      toast.push('warn', '单回合时长需在 30–3600 秒之间'); return;
    }
    if (!Number.isInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 500) {
      toast.push('warn', '工具调用上限需在 1–500 之间'); return;
    }
    setBusy(true);
    try {
      await updateSettings({ maxTurnSeconds, maxToolCalls });
      toast.push('success', '运行限额已保存');
    } catch (e) {
      toast.push('error', `保存失败：${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="set-section" aria-label="偏好">
      <SectionHeader icon={SlidersHorizontal} title="偏好" description={pythonRuntime
        ? '外观偏好保存在此浏览器。'
        : '界面主题与代理运行限额。限额用于防止单个回合无限运行。'} />

      <AppearanceControls settings={settings} updateSettings={updateSettings} />

      {!pythonRuntime && <div className="set-card">
        <h3 className="set-card-title">运行限额</h3>
        <div className="set-form-grid">
          <Field label="单回合最长时间（秒）" hint="范围 30–3600。超时后回合标记为达到上限。">
            <TextInput type="number" min={30} max={3600} value={maxTurnSeconds} onChange={(e) => { touched.current = true; setMaxTurnSeconds(Number(e.target.value)); }} aria-label="单回合最长时间" />
          </Field>
          <Field label="单回合工具调用上限" hint="范围 1–500。达到上限后回合停止。">
            <TextInput type="number" min={1} max={500} value={maxToolCalls} onChange={(e) => { touched.current = true; setMaxToolCalls(Number(e.target.value)); }} aria-label="工具调用上限" />
          </Field>
        </div>
        <div className="set-form-actions">
          <button className="button primary" onClick={() => void saveLimits()} disabled={busy}>
            {busy && <LoaderCircle size={14} className="spin" aria-hidden />} 保存限额
          </button>
        </div>
      </div>}
    </section>
  );
}
