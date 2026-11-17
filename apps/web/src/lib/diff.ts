export type DiffPart = { type: 'same' | 'added' | 'removed'; text: string };

/** Tokenise into words and the whitespace/punctuation between them, so output rejoins exactly. */
function tokens(s: string): string[] {
  return s.match(/\s+|[\w.+#%$'-]+|[^\s\w]/g) ?? [];
}

/**
 * Word-level diff (longest common subsequence). Comparison ignores case and a
 * leading bullet, so "- Built" vs "Built" isn't shown as a change.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before.replace(/^\s*[-*\u2022]\s*/, ''));
  const b = tokens(after.replace(/^\s*[-*\u2022]\s*/, ''));
  const eq = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();

  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = eq(a[i]!, b[j]!) ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i]!, b[j]!)) {
      push('same', b[j]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) push('removed', a[i++]!);
    else push('added', b[j++]!);
  }
  while (i < n) push('removed', a[i++]!);
  while (j < m) push('added', b[j++]!);
  return parts;
}
