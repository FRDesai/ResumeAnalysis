export interface Line {
  /** Stable line ID, e.g. "L1". Evidence quotes cite these IDs. */
  id: string;
  text: string;
}

/**
 * Normalise extracted text so the same document always yields the same lines:
 * Unicode NFKC, unify line endings, strip zero-width chars, collapse runs of
 * whitespace inside a line, and drop empty lines.
 */
export function normalizeText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

/** Split normalised text into lines with IDs L1..Ln. */
export function toLines(normalized: string): Line[] {
  if (!normalized) return [];
  return normalized.split('\n').map((text, i) => ({ id: `L${i + 1}`, text }));
}
