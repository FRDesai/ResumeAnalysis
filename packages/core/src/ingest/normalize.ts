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
    .reduce<string[]>((out, line) => {
      const prev = out[out.length - 1];
      if (prev !== undefined && isContinuation(prev, line)) out[out.length - 1] = `${prev} ${line}`;
      else out.push(line);
      return out;
    }, [])
    .join('\n');
}

const BULLET = /^([-*\u2022\u00B7\u25AA\u25CF\u2013]|\d+[.)])\s/;
const CONNECTOR = /(,|\b(and|or|to|for|of|with|by|in|on|at|as|from|the|a|an|via|using|into|across|&))$/i;

/**
 * PDFs hard-wrap long lines, so one resume bullet often arrives as two lines.
 * A quote spanning the wrap could never be verified, so join a line into the
 * previous one when it is clearly a continuation: it starts in lowercase (but
 * not "iOS"/"eBay"-style names), or the previous line ends with a comma or a
 * connecting word. New bullets and lines after a heading ("Skills:") never join.
 */
function isContinuation(prev: string, line: string): boolean {
  if (BULLET.test(line) || prev.endsWith(':')) return false;
  const startsLower = /^[a-z][a-z]/.test(line);
  return startsLower || CONNECTOR.test(prev);
}

/** Split normalised text into lines with IDs L1..Ln. */
export function toLines(normalized: string): Line[] {
  if (!normalized) return [];
  return normalized.split('\n').map((text, i) => ({ id: `L${i + 1}`, text }));
}
