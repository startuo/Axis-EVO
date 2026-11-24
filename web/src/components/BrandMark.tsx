/**
 * Axis 官方品牌标徽组合：图形标志位于文字 Logo 左侧，随暗/浅主题切换标徽资产。
 * 折叠为侧边图标栏时仅保留图形标志，保持视觉锚点稳定。
 */
export interface BrandMarkProps {
  theme: 'dark' | 'light';
  /** 是否同时显示右侧 Axis 文字 Logo */
  showWordmark?: boolean;
  /** 尺寸预设：侧栏头部用 sm，启动屏用 lg */
  size?: 'sm' | 'lg';
  /** 是否输出仅供读屏器的品牌名文本（启动屏已有可见文案时关闭） */
  srLabel?: boolean;
}

export function BrandMark({ theme, showWordmark = true, size = 'sm', srLabel = true }: BrandMarkProps) {
  const markSrc = theme === 'dark' ? '/axis-mark-dark.png' : '/axis-mark-light.png';
  return (
    <span className={`brand-lockup brand-lockup-${size}`}>
      <img src={markSrc} alt="" aria-hidden="true" className="brand-emblem" />
      {showWordmark && <img src="/axis-wordmark.png" alt="Axis" className="brand-wordmark" />}
      {srLabel && <span className="sr-only">Axis-Evo</span>}
    </span>
  );
}
