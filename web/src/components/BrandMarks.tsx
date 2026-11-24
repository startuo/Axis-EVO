/** Monochrome brand glyphs for suggestion chips (currentColor → tokens). */

export function SlackMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden className="brand-mark">
      <rect x="8.6" y="1.6" width="2.8" height="7.6" rx="1.4" />
      <rect x="10.8" y="8.6" width="7.6" height="2.8" rx="1.4" />
      <rect x="8.6" y="10.8" width="2.8" height="7.6" rx="1.4" />
      <rect x="1.6" y="8.6" width="7.6" height="2.8" rx="1.4" />
      <rect x="12.2" y="3.2" width="2.8" height="2.8" rx="1.4" />
      <rect x="14" y="12.2" width="2.8" height="2.8" rx="1.4" />
      <rect x="5" y="14" width="2.8" height="2.8" rx="1.4" />
      <rect x="3.2" y="5" width="2.8" height="2.8" rx="1.4" />
    </svg>
  );
}

export function LinearMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
      className="brand-mark"
    >
      <circle cx="10" cy="10" r="8.2" />
      <path d="M3.6 12.4 12.4 3.6" />
      <path d="M5.4 15.4 15.4 5.4" />
      <path d="M8.6 17.6 17.6 8.6" />
    </svg>
  );
}
