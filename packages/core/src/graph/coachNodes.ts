import { renderLines } from '../guard.js';
import type { Line } from '../ingest/normalize.js';
import type { Models } from '../llm/types.js';
import { renderPrompt } from '../prompts.js';
import {
  GuardSchema,
  QuestionsSchema,
  RewritesSchema,
  type Flag,
  type InterviewQuestion,
  type Rewrite,
} from '../schemas.js';
import { addedEntities } from '../verify/entities.js';
import { normForMatch } from '../verify/evidence.js';
import { guardInputs } from './guardNode.js';
import type { AnalysisStateType, AnalysisUpdate } from './state.js';

type Node = (s: AnalysisStateType) => Promise<AnalysisUpdate>;

export const QUESTION_COUNT = 8;
export const REWRITE_COUNT = 5;

/** JD lines get a J prefix in the guard prompt so IDs don't collide with resume lines. */
const asJ = (lines: Line[]) => lines.map((l) => ({ id: l.id.replace(/^L/, 'J'), text: l.text }));

export const makeCoachNodes = (models: Models) => {
  /**
   * guard: deterministic regex scan, plus a light LLM check (cheap parse model)
   * that catches paraphrased injections. Flags are reported, never acted on.
   * If the LLM check fails, the regex flags still stand and the run continues.
   */
  const guard: Node = async (s) => {
    const flags: Flag[] = guardInputs(s.resumeLines, s.jdLines);
    try {
      const p = renderPrompt('guard', { resume: renderLines(s.resumeLines), jd: renderLines(asJ(s.jdLines)) });
      const r = await models.parse.structured({ name: 'guardCheck', schema: GuardSchema, ...p });
      for (const item of r.data.suspicious) {
        const isJd = item.lineId.startsWith('J');
        const id = isJd ? item.lineId.replace(/^J/, 'L') : item.lineId;
        const line = (isJd ? s.jdLines : s.resumeLines).find((l) => l.id === id);
        const source = isJd ? 'jd' : 'resume';
        if (!line || flags.some((f) => f.source === source && f.lineId === id)) continue;
        flags.push({ source, lineId: id, pattern: 'llm-detected', text: line.text.slice(0, 200) });
      }
      return { flags, usage: r.usage };
    } catch {
      return { flags };
    }
  };

  /** generateQuestions: 8 questions aimed at gaps and unverified or impressive claims. */
  const generateQuestions: Node = async (s) => {
    const gaps = s.requirements
      .filter((r) => r.status !== 'met')
      .sort((a, b) => (a.kind === b.kind ? b.weight - a.weight : a.kind === 'must' ? -1 : 1))
      .map((r) => `${r.status}, ${r.kind}, ${r.requirementId}: ${r.text}`);

    const lineText = new Map(s.resumeLines.map((l) => [l.id, l.text]));
    const claims = new Map<string, string>();
    for (const d of Object.values(s.dimensions)) {
      for (const e of d?.evidence ?? []) {
        if (!e.verified) claims.set(e.lineId, `${e.lineId} (UNVERIFIED): ${e.quote}`);
      }
    }
    for (const m of s.resume?.metrics ?? []) {
      if (!claims.has(m.lineId) && lineText.has(m.lineId)) claims.set(m.lineId, `${m.lineId}: ${lineText.get(m.lineId)}`);
    }

    const p = renderPrompt('questions', {
      gaps: gaps.join('\n') || '(none)',
      claims: [...claims.values()].slice(0, 12).join('\n') || '(none)',
      jd: renderLines(s.jdLines),
      resume: renderLines(s.resumeLines),
    });
    const r = await models.score.structured({
      name: 'generateQuestions',
      schema: QuestionsSchema,
      ...p,
      validate: (d) => {
        if (d.questions.length !== QUESTION_COUNT) return `expected exactly ${QUESTION_COUNT} questions, got ${d.questions.length}`;
        const bad = d.questions.findIndex((q) => q.probes.length !== 2);
        return bad >= 0 ? `question ${bad + 1} must have exactly 2 probes` : null;
      },
    });

    const reqIds = new Set(s.requirements.map((q) => q.requirementId));
    const questions: InterviewQuestion[] = r.data.questions.map((q, i) => ({
      ...q,
      id: `Q${i + 1}`,
      // Drop references the model made up, so the UI never links to a missing line.
      requirementId: q.requirementId && reqIds.has(q.requirementId) ? q.requirementId : null,
      lineId: q.lineId && lineText.has(q.lineId) ? q.lineId : null,
    }));
    return { questions, usage: r.usage };
  };

  /**
   * rewriteBullets: the model picks and rewrites the 5 weakest bullets; code takes
   * the original text from the resume and rejects any rewrite that adds a number,
   * tool or name not in that original line (the original is kept instead).
   */
  const rewriteBullets: Node = async (s) => {
    const p = renderPrompt('rewrite', { resume: renderLines(s.resumeLines) });
    const r = await models.score.structured({ name: 'rewriteBullets', schema: RewritesSchema, ...p });
    const seen = new Set<string>();
    const rewrites: Rewrite[] = [];
    for (const rw of r.data.rewrites) {
      const line = s.resumeLines.find((l) => l.id === rw.lineId);
      // Skip unknown lines, duplicates, and "rewrites" that only change case, bullets or spacing.
      if (!line || seen.has(line.id) || normForMatch(rw.suggestion) === normForMatch(line.text)) continue;
      seen.add(line.id);
      const added = addedEntities(line.text, rw.suggestion);
      rewrites.push({
        lineId: line.id,
        original: line.text,
        suggestion: rw.suggestion,
        why: rw.why,
        accepted: added.length === 0,
        addedEntities: added,
      });
      if (rewrites.length === REWRITE_COUNT) break;
    }
    return { rewrites, usage: r.usage };
  };

  return { guard, generateQuestions, rewriteBullets };
};
