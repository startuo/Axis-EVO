import { useContext } from "react";
import { ThemeContext } from "../../lib/theme";

export function AxisLogo({ className = "", size = 30 }: { className?: string; size?: number }) {
  const dark = useContext(ThemeContext);
  return <span className={`axis-brandmark ${className}`} aria-hidden="true">
    <img className={dark ? "axis-logo-dark" : "axis-logo-light"} src={dark ? "/axis-dark.png" : "/axis-light.png"} width={size} height={size + 4} alt="" />
  </span>;
}
