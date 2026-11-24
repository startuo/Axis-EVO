/** Minimal line-level diff (LCS) for preview cards. Pure + unit-testable. */
export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

const MAX_LINES = 400;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  if (a.length + b.length > MAX_LINES * 2) {
    return [
      ...a.map((text): DiffLine => ({ type: 'del', text })),
      ...b.map((text): DiffLine => ({ type: 'add', text })),
    ];
  }
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const ai = a[i] ?? '';
      const bj = b[j] ?? '';
      dp[i]![j] = ai === bj ? (dp[i + 1]![j + 1] ?? 0) + 1 : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const ai = a[i] ?? '';
    const bj = b[j] ?? '';
    if (ai === bj) {
      out.push({ type: 'same', text: ai });
      i++;
      j++;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      out.push({ type: 'del', text: ai });
      i++;
    } else {
      out.push({ type: 'add', text: bj });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] ?? '' });
  while (j < m) out.push({ type: 'add', text: b[j++] ?? '' });
  return out;
}
