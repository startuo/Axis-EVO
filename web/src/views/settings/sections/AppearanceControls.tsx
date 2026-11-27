import { Check, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import type { Settings } from '@axis/protocol';
import { useAppearance } from '../../../hooks/useTheme';
import { DEFAULT_APPEARANCE, OBSIDIAN_PRISM_ACCENTS, OBSIDIAN_PRISM_PALETTES, type AppearancePreference } from '../../../lib/appearance';
import type { PreferencesSectionProps } from './PreferencesSection';

const themes = [
  { id: 'default', name: 'Axis 默认', description: '暖陶土色调与积云背景' },
  { id: 'obsidian-prism', name: 'Obsidian Prism（黑曜棱镜）', description: '四套色板与五档强调色' },
] as const;
const modes = [
  { id: 'dark', label: '深色', icon: Moon },
  { id: 'light', label: '浅色', icon: Sun },
  { id: 'system', label: '跟随系统', icon: Monitor },
] as const;
const motionTiers = [
  { id: 'standard', label: '标准光效' },
  { id: 'focus', label: '专注省电' },
] as const;
const widgets = [
  { key: 'prismMascots', label: '桌面像素伙伴', description: '在输入舱上方显示可拖拽的像素伙伴。' },
  { key: 'prismVial', label: '物理浅水上下文试管', description: '用受阻尼的液面展示上下文用量。' },
  { key: 'prismCrystal', label: '推理滑块切工水晶', description: '在推理轨道上叠加随指针变化的切面。' },
  { key: 'prismRim', label: '输入舱棱镜边框', description: '指针经过输入舱边缘时点亮细边。' },
] as const;

export function AppearanceControls({ settings, updateSettings }: {
  settings: Settings | null;
  updateSettings: PreferencesSectionProps['updateSettings'];
}) {
  const appearance = useAppearance(settings, updateSettings);
  const customised = (Object.keys(DEFAULT_APPEARANCE) as (keyof AppearancePreference)[])
    .some((key) => appearance[key] !== DEFAULT_APPEARANCE[key]);

  return <>
    <div className="set-card">
      <div className="set-appearance-heading">
        <h3 className="set-card-title">界面主题包</h3>
        <button className="text-button set-appearance-reset" type="button" onClick={appearance.reset} disabled={!customised}>
          <RotateCcw size={14} aria-hidden /> 恢复默认
        </button>
      </div>
      <div className="set-appearance-grid" role="radiogroup" aria-label="界面主题包">
        {themes.map(({ id, name, description }) => (
          <label key={id} className="set-appearance-choice">
            <input type="radio" name="axis-ui-style" aria-label={name}
              checked={appearance.uiStyle === id} onChange={() => appearance.update({ uiStyle: id })} />
            <span className="set-appearance-preview" data-preview-style={id} aria-hidden>
              <span /><span /><span /><span />
            </span>
            <span className="set-appearance-name">{name}{appearance.uiStyle === id && <Check size={15} aria-hidden />}</span>
            <span className="set-appearance-description">{description}</span>
          </label>
        ))}
      </div>
      <div className="set-appearance-controls">
        <div>
          <h4>明暗模式</h4>
          <div className="set-theme-row" role="group" aria-label="明暗模式">
            {modes.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" aria-pressed={appearance.themeMode === id}
                className={`set-theme-btn${appearance.themeMode === id ? ' selected' : ''}`}
                onClick={() => appearance.update({ themeMode: id })}>
                <Icon size={15} aria-hidden /> {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <h4>动效档位</h4>
          <div className="set-theme-row" role="group" aria-label="动效档位">
            {motionTiers.map(({ id, label }) => (
              <button key={id} type="button" aria-pressed={appearance.motionTier === id}
                className={`set-theme-btn${appearance.motionTier === id ? ' selected' : ''}`}
                onClick={() => appearance.update({ motionTier: id })}>{label}</button>
            ))}
          </div>
        </div>
      </div>
    </div>

    <div className="set-card">
      <h3 className="set-card-title">交互与光学挂件</h3>
      <div className="set-appearance-widgets">
        {widgets.map(({ key, label, description }) => (
          <div className="set-appearance-widget" key={key}>
            <div><div className="set-appearance-name">{label}</div><div className="set-appearance-description">{description}</div></div>
            <button type="button" className={`set-toggle${appearance[key] ? ' on' : ''}`}
              role="switch" aria-checked={appearance[key]} aria-label={label}
              onClick={() => appearance.update({ [key]: !appearance[key] })}>
              <span className="set-toggle-thumb" />
            </button>
          </div>
        ))}
      </div>
    </div>

    {appearance.uiStyle === 'obsidian-prism' && <section className="set-card" aria-label="Obsidian Prism 专属设置">
      <h3 className="set-card-title">棱镜色板</h3>
      <div className="set-appearance-grid set-appearance-palettes" role="radiogroup" aria-label="棱镜色板">
        {OBSIDIAN_PRISM_PALETTES.map((palette) => (
          <label key={palette.id} className="set-appearance-choice">
            <input type="radio" name="axis-prism-palette" aria-label={palette.label}
              checked={appearance.activePrismPalette === palette.id} onChange={() => appearance.choosePalette(palette.id)} />
            <span className="set-appearance-swatches" aria-hidden>
              {[palette.sidebar, palette.canvas, palette.surface, palette.accent].map((colour) => (
                <span key={colour} style={{ background: colour }} />
              ))}
            </span>
            <span className="set-appearance-name">{palette.label}</span>
            <span className="set-appearance-description">{palette.desc}</span>
          </label>
        ))}
      </div>
      <h4 className="set-appearance-accent-heading">工业强调色</h4>
      <div className="set-theme-row" role="radiogroup" aria-label="工业强调色">
        {OBSIDIAN_PRISM_ACCENTS.map(({ id, label, swatch }) => (
          <label key={id} className="set-appearance-choice set-accent-choice">
            <input type="radio" name="axis-prism-accent" aria-label={label}
              checked={appearance.prismAccent === id} onChange={() => appearance.update({ prismAccent: id })} />
            <span className="set-accent-dot" style={{ background: swatch }} aria-hidden />
            {label}
          </label>
        ))}
      </div>
    </section>}
  </>;
}
