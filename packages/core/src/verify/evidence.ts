import { distance } from 'fastest-levenshtein';
import type { Line } from '../ingest/normalize.js';
import type { Evidence, VerifiedEvidence } from '../schemas.js';

/** PRD threshold: a quote must match its line with normalised similarity >= 0.9. */
export const SIMILARITY_THRESHOLD = 0.9;

/** Normalise for comparison only: case, quotes/dashes, punctuation spacing, whitespace. */
export function normForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/^[\s\-*\u2022\u00B7]+/, '') // leading bullet markers
    .replace(/\s+/g, ' ')
    .trim();
}

/** 1 - levenshtein / max length, in [0, 1]. */
export function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  return 1 - distance(a, b) / Math.max(a.length, b.length);
}

/**
 * Best similarity between a quote and any contiguous run of words in the line.
 * Quotes are usually a fragment of a line, so we compare against windows of the
 * line with roughly the quote's word count, not the whole line.
 */
export function bestWindowSimilarity(quote: string, line: string): number {
  const q = normForMatch(quote);
  const l = normForMatch(line);
  if (!q) return 0;
  if (l.includes(q)) return 1;

  const lw = l.split(' ');
  const qn = q.split(' ').length;
  let best = similarity(q, l);
  for (let size = Math.max(1, qn - 2); size <= Math.min(lw.length, qn + 2); size++) {
    for (let start = 0; start + size <= lw.length; start++) {
      const s = similarity(q, lw.slice(start, start + size).join(' '));
      if (s > best) best = s;
      if (best === 1) return 1;
    }
  }
  return best;
}

/**
 * Check one quote. It must match the cited line. If the model cited the wrong
 * line ID but the exact text is on another line, the quote is still real, so we
 * correct the line ID (deterministically) rather than fail it.
 */
export function verifyQuote(ev: Evidence, lines: Line[]): VerifiedEvidence {
  // A quote that's only a word or two proves nothing ("Python") and would match anywhere.
  if (normForMatch(ev.quote).length < 8) {
    return { ...ev, verified: false, similarity: 0 };
  }
  const cited = lines.find((l) => l.id === ev.lineId);
  const citedSim = cited ? bestWindowSimilarity(ev.quote, cited.text) : 0;
  if (citedSim >= SIMILARITY_THRESHOLD) return { ...ev, verified: true, similarity: citedSim };

  let best: { line: Line; sim: number } | null = null;
  for (const line of lines) {
    const sim = bestWindowSimilarity(ev.quote, line.text);
    if (!best || sim > best.sim) best = { line, sim };
  }
  if (best && best.sim >= SIMILARITY_THRESHOLD) {
    return { lineId: best.line.id, quote: ev.quote, verified: true, similarity: best.sim };
  }
  return { ...ev, verified: false, similarity: Math.max(citedSim, best?.sim ?? 0) };
}

export function verifyAll(evidence: Evidence[], lines: Line[]): VerifiedEvidence[] {
  return evidence.map((e) => verifyQuote(e, lines));
}
