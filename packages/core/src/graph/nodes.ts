import { guardInputs } from './guardNode.js';
import { renderLines } from '../guard.js';
import { countTokens, MAX_INPUT_TOKENS } from '../ingest/tokens.js';
import { InputTooLargeError, EmptyDocumentError } from '../ingest/index.js';
import type { Models } from '../llm/types.js';
import { PROMPT_VERSION, renderPrompt } from '../prompts.js';
import {
  DIMENSIONS,
  DIMENSION_WEIGHTS,
  JDSchema,
  MatchSchema,
  ResumeSchema,
  ScoreSchema,
  type DimensionName,
  type ReportDimension,
  type ReportGap,
  type ReportRequirement,
} from '../schemas.js';
import { verifyAll } from '../verify/evidence.js';
import type { AnalysisStateType, AnalysisUpdate } from './state.js';

/** PRD: at most 2 rescoring retries after the first attempt. */
export const MAX_SCORE_ATTEMPTS = 3;

type Node = (s: AnalysisStateType) => Promise<AnalysisUpdate>;

/** ingest (no LLM): inputs arrive already line-numbered; re-check size before any LLM call. */
export const ingest: Node = async (s) => {
  if (!s.resumeLines.length || !s.jdLines.length) throw new EmptyDocumentError();
  for (const lines of [s.resumeLines, s.jdLines]) {
    const tokens = countTokens(lines.map((l) => l.text).join('\n'));
    if (tokens > MAX_INPUT_TOKENS) throw new InputTooLargeError(tokens);
  }
  return {};
};

export const guard: Node = async (s) => ({ flags: guardInputs(s.resumeLines, s.jdLines) });

export const makeNodes = (models: Models) => {
  const parseResume: Node = async (s) => {
    const p = renderPrompt('parse-resume', { resume: renderLines(s.resumeLines) });
    const r = await models.parse.structured({ name: 'parseResume', schema: ResumeSchema, ...p });
    return { resume: r.data, usage: r.usage };
  };

  const parseJD: Node = async (s) => {
    const p = renderPrompt('parse-jd', { jd: renderLines(s.jdLines) });
    const r = await models.parse.structured({ name: 'parseJD', schema: JDSchema, ...p });
    const requirements = r.data.requirements.map((q) => ({
      ...q,
      weight: Math.min(3, Math.max(1, Math.round(q.weight))),
    }));
    return { jd: { ...r.data, requirements }, usage: r.usage };
  };

  /** matchRequirements: LLM decides status; code verifies every quote and downgrades unsupported claims. */
  const matchRequirements: Node = async (s) => {
    const reqs = s.jd?.requirements ?? [];
    const p = renderPrompt('match', {
      requirements: reqs.map((r) => `${r.id} [${r.kind}]: ${r.text}`).join('\n'),
      resume: renderLines(s.resumeLines),
    });
    const r = await models.score.structured({ name: 'matchRequirements', schema: MatchSchema, ...p });
    const byId = new Map(r.data.matches.map((m) => [m.requirementId, m]));

    const requirements: ReportRequirement[] = reqs.map((req) => {
      const m = byId.get(req.id);
      const evidence = verifyAll((m?.evidence ?? []).slice(0, 3), s.resumeLines).filter((e) => e.verified);
      let status = m?.status ?? 'missing';
      let note = m?.note ?? 'Not assessed by the model';
      if (status !== 'missing' && evidence.length === 0) {
        status = 'missing';
        note = `No verifiable evidence in the resume. (Model said: ${note})`;
      }
      return { requirementId: req.id, text: req.text, kind: req.kind, weight: req.weight, status, evidence, note };
    });
    return { requirements, usage: r.usage };
  };

  /** scoreDimensions: scores all dimensions first, then only the ones that failed verification. */
  const scoreDimensions: Node = async (s) => {
    const dims = s.pendingDims.length ? s.pendingDims : [...DIMENSIONS];
    const feedback = s.feedback
      ? `IMPORTANT - your previous answer cited quotes that are NOT in the resume:\n${s.feedback}\nUse only exact text copied from the cited line. If you cannot find supporting text, pick different lines.`
      : '';
    const p = renderPrompt('score', {
      dimensions: dims.join(', '),
      jd: renderLines(s.jdLines),
      resume: renderLines(s.resumeLines),
      feedback,
    });
    const r = await models.score.structured({ name: 'scoreDimensions', schema: ScoreSchema, ...p });
    const candidates = r.data.dimensions
      .filter((d) => dims.includes(d.name))
      .map((d) => ({
        ...d,
        score: Math.min(5, Math.max(1, Math.round(d.score))),
        evidence: d.evidence.slice(0, 3),
      }));
    return { candidates, pendingDims: dims, scoreAttempts: s.scoreAttempts + 1, usage: r.usage };
  };

  return { parseResume, parseJD, matchRequirements, scoreDimensions };
};

/**
 * verifyEvidence (no LLM): every quote must be found in its line (similarity >= 0.9).
 * Dimensions where all quotes verify are final. The rest are sent back for
 * rescoring with feedback, up to MAX_SCORE_ATTEMPTS; after that a dimension keeps
 * its score only if at least one quote verified, otherwise it is "insufficient evidence".
 */
export const verifyEvidence: Node = async (s) => {
  const final: Partial<Record<DimensionName, ReportDimension>> = {};
  const failed: DimensionName[] = [];
  const feedbackLines: string[] = [];
  let checked = 0;
  let verifiedCount = 0;
  const lastTry = s.scoreAttempts >= MAX_SCORE_ATTEMPTS;

  const returned = new Map(s.candidates.map((c) => [c.name, c]));
  for (const name of s.pendingDims) {
    const c = returned.get(name);
    if (!c || c.evidence.length === 0) {
      if (lastTry) final[name] = insufficient(name, c?.reason ?? 'No evidence given');
      else {
        failed.push(name);
        feedbackLines.push(`- ${name}: no evidence was given; give 1-3 exact quotes.`);
      }
      continue;
    }
    const ev = verifyAll(c.evidence, s.resumeLines);
    checked += ev.length;
    verifiedCount += ev.filter((e) => e.verified).length;
    const allOk = ev.every((e) => e.verified);

    if (allOk) {
      final[name] = { name, score: c.score, reason: c.reason, evidence: ev, status: 'verified' };
    } else if (!lastTry) {
      failed.push(name);
      for (const e of ev.filter((x) => !x.verified)) {
        feedbackLines.push(`- ${name}: ${e.lineId} does not contain "${e.quote}"`);
      }
    } else if (ev.some((e) => e.verified)) {
      // Keep the score; unverified quotes stay visible but marked verified=false.
      final[name] = { name, score: c.score, reason: c.reason, evidence: ev, status: 'verified' };
    } else {
      final[name] = { ...insufficient(name, c.reason), evidence: ev };
    }
  }

  return {
    dimensions: final,
    pendingDims: failed,
    feedback: feedbackLines.join('\n'),
    // The PRD metric "evidence validity" is measured on the first attempt only.
    firstPass: s.firstPass ?? { checked, verified: verifiedCount },
  };
};

function insufficient(name: DimensionName, reason: string): ReportDimension {
  return { name, score: null, reason: `Insufficient evidence. ${reason}`, evidence: [], status: 'insufficient_evidence' };
}

/** Route after verification: loop back while dimensions failed and retries remain. */
export function afterVerify(s: AnalysisStateType): 'scoreDimensions' | 'assembleReport' {
  return s.pendingDims.length > 0 && s.scoreAttempts < MAX_SCORE_ATTEMPTS ? 'scoreDimensions' : 'assembleReport';
}

/** assembleReport (no LLM): all arithmetic happens here, in code. */
export const makeAssemble = (models: Models): Node => async (s) => {
  const dimensions = DIMENSIONS.map((n) => s.dimensions[n] ?? insufficient(n, 'Not scored'));
  const scored = dimensions.filter((d) => d.score !== null);
  const wSum = scored.reduce((a, d) => a + DIMENSION_WEIGHTS[d.name], 0);
  const avg = wSum ? scored.reduce((a, d) => a + DIMENSION_WEIGHTS[d.name] * d.score!, 0) / wSum : null;
  const overall = avg === null ? null : Math.round(((avg - 1) / 4) * 100);

  const gaps: ReportGap[] = s.requirements
    .filter((r) => r.status !== 'met')
    .map((r) => ({
      requirementId: r.requirementId,
      text: r.text,
      kind: r.kind,
      weight: r.weight,
      status: r.status as 'missing' | 'partial',
      note: r.note,
    }))
    .sort((a, b) =>
      a.kind !== b.kind ? (a.kind === 'must' ? -1 : 1)
      : a.status !== b.status ? (a.status === 'missing' ? -1 : 1)
      : b.weight - a.weight,
    );

  const mustMissing = gaps.filter((g) => g.kind === 'must' && g.status === 'missing').length;
  const fp = s.firstPass ?? { checked: 0, verified: 0 };

  return {
    report: {
      overall,
      verdict: verdict(overall, mustMissing),
      dimensions,
      requirements: s.requirements,
      gaps,
      questions: [],
      rewrites: [],
      flags: s.flags,
      promptVersion: PROMPT_VERSION,
      model: { parse: models.parse.model, score: models.score.model },
      verifier: {
        scoreAttempts: s.scoreAttempts,
        firstPassValidity: fp.checked ? fp.verified / fp.checked : 1,
        firstPassChecked: fp.checked,
        firstPassVerified: fp.verified,
      },
    },
  };
};

export function verdict(overall: number | null, mustMissing: number): string {
  if (overall === null) return 'Insufficient evidence to score this resume';
  const band =
    overall >= 75 ? 'Strong fit' : overall >= 55 ? 'Good fit with gaps' : overall >= 35 ? 'Partial fit' : 'Weak fit';
  const gaps = mustMissing === 0 ? 'all must-haves covered' : `${mustMissing} must-have requirement${mustMissing > 1 ? 's' : ''} missing`;
  return `${band}: ${gaps}`;
}
