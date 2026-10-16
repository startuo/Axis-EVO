// Adapted from Caho1/open-claude-ui @ 2834bc1 (MIT; see THIRD_PARTY_NOTICES.md).
export const cdsMotion = {
  snappy: { type: "spring", stiffness: 600, damping: 30, mass: 1 },
  gentle: { type: "spring", stiffness: 320, damping: 28, mass: 1 },
  panel: { type: "spring", stiffness: 1200, damping: 80, mass: 0.1 },
} as const;
