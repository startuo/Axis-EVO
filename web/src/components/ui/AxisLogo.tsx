export function AxisLogo({ className = "", size = 30 }: { className?: string; size?: number }) {
  return <span className={`axis-brandmark ${className}`} aria-hidden="true">
    <img className="axis-logo-light" src="/axis-light.png" width={size} height={size + 4} alt="" />
    <img className="axis-logo-dark" src="/axis-dark.png" width={size} height={size + 4} alt="" />
  </span>;
}
