/**
 * Entity diff for bullet rewrites (PRD: "a check rejects any rewrite that adds
 * numbers, tools or employers missing from the original").
 *
 * Deterministic and intentionally strict: a rewrite may rephrase and restructure,
 * but every number and every "name-like" token (tools, companies, acronyms) it
 * contains must already appear in the original bullet. A false rejection only
 * costs a suggestion; a false acceptance puts an invented fact on a resume.
 */

/** Numbers as normalised strings: "3,000" -> "3000", "40%" -> "40", "$2.5M" -> "2.5". */
export function extractNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    out.add(m[0].replace(/,/g, '').replace(/\.0+$/, ''));
  }
  return out;
}

/** Words that are capitalised only because they start a sentence or are generic. */
const COMMON = new Set(['i', 'a', 'an', 'the', 'and', 'or', 'by', 'for', 'to', 'with', 'in', 'on', 'of']);

/**
 * Name-like tokens: acronyms (AWS), mixed case (TypeScript, iOS), tokens with
 * . + # (Node.js, C++, C#), and capitalised words that don't start a sentence
 * (Stripe, Google). Sentence-initial words ("Designed ...") are skipped.
 */
export function extractNames(text: string): string[] {
  const names: string[] = [];
  const sentences = text.split(/(?<=[.!?;:])\s+|\s+-\s+|^\s*[-*\u2022]\s*/);
  for (const sentence of sentences) {
    const tokens = sentence.match(/[A-Za-z][A-Za-z0-9.+#-]*[A-Za-z0-9+#]|[A-Za-z]/g) ?? [];
    tokens.forEach((tok, i) => {
      const t = tok.replace(/[.]+$/, '');
      if (COMMON.has(t.toLowerCase())) return;
      const acronym = /^[A-Z0-9]{2,}$/.test(t) && /[A-Z]/.test(t);
      const mixed = /[a-z][A-Z]|^[a-z]+[A-Z]/.test(t);
      const symbol = /[.+#]/.test(t);
      const capitalised = /^[A-Z][a-z]/.test(t) && i > 0;
      if (acronym || mixed || symbol || capitalised) names.push(t);
    });
  }
  return names;
}

/** Entities in `rewrite` that do not appear in `original`. Empty = faithful. */
export function addedEntities(original: string, rewrite: string): string[] {
  const origLower = original.toLowerCase();
  const origNums = extractNumbers(original);
  const added = new Set<string>();
  for (const n of extractNumbers(rewrite)) if (!origNums.has(n)) added.add(n);
  for (const name of extractNames(rewrite)) {
    if (!origLower.includes(name.toLowerCase())) added.add(name);
  }
  return [...added];
}
