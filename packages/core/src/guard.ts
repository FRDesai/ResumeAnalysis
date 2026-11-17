import type { Line } from './ingest/normalize.js';
import type { Flag } from './schemas.js';

/**
 * Patterns that look like instructions aimed at an AI grader. Matching lines are
 * flagged and shown in the report; they are never acted on. (A light LLM check
 * that catches paraphrased injections is added in Phase 4.)
 */
export const INJECTION_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'ignore-instructions', re: /\b(ignore|disregard|forget)\b.{0,40}\b(instructions?|prompts?|rules|above|previous)\b/i },
  { name: 'score-demand', re: /\b(rate|score|grade|rank)\b.{0,40}\b(5\s*\/\s*5|10\s*\/\s*10|100\s*%|perfect|highest|top)\b/i },
  { name: 'role-override', re: /\b(you are now|act as|pretend to be|new instructions|system prompt)\b/i },
  { name: 'ai-addressed', re: /\b(dear|attention|note to)\s+(ai|llm|chatgpt|gpt|claude|assistant|model|screener)\b/i },
  { name: 'hire-demand', re: /\b(must|should)\s+(be\s+)?(hire|hired|shortlist|shortlisted|advance)\b/i },
  { name: 'markup-injection', re: /<\/?\s*(system|assistant|instructions?|resume|job_description)\b/i },
];

export function scanForInjection(lines: Line[], source: Flag['source']): Flag[] {
  const flags: Flag[] = [];
  for (const line of lines) {
    for (const p of INJECTION_PATTERNS) {
      if (p.re.test(line.text)) {
        flags.push({ source, lineId: line.id, pattern: p.name, text: line.text.slice(0, 200) });
        break;
      }
    }
  }
  return flags;
}

/**
 * Render lines for a prompt as "L1: text". Any tag-like text that could close
 * or open our delimiters is defused, so a resume can't break out of <resume>.
 */
export function renderLines(lines: Line[]): string {
  return lines
    .map((l) => `${l.id}: ${l.text.replace(/<\s*\/?\s*(resume|job_description|requirements)\b[^>]*>/gi, '[tag removed]')}`)
    .join('\n');
}
