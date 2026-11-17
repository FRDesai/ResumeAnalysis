import { buildGraph, prepareDocument, runAnalysis, StructuredOutputError, type LlmClient, type Models } from '@rm/core';
import type { EvalCase } from './dataset.js';
import { judgeQuestions } from './judge.js';
import { aggregate, checkGate, scoreCase, type CaseRun, type CaseScore, type GateResult, type Metrics } from './metrics.js';

export interface EvalRunResult {
  runs: CaseRun[];
  scores: CaseScore[];
  metrics: Metrics;
  gate: GateResult;
}

/** Run one case through the exact production graph (same prompts, same verifier). */
export async function runCase(c: EvalCase, models: Models, judge?: LlmClient | null): Promise<CaseRun> {
  const t0 = Date.now();
  try {
    const resume = prepareDocument(c.resume);
    const jd = prepareDocument(c.jd);
    const { report, usage } = await runAnalysis({
      graph: buildGraph(models),
      input: { resumeLines: resume.lines, jdLines: jd.lines },
      threadId: `eval-${c.id}-${t0}`,
    });
    const latencyMs = Date.now() - t0; // measured before judging: judging is not part of the product
    let judged: CaseRun['judge'] = null;
    if (judge && report.questions.length) {
      try {
        judged = await judgeQuestions(judge, { report, resumeLines: resume.lines, jdLines: jd.lines });
      } catch {
        judged = null; // a judge failure leaves the metric n/a for this case; it does not fail the product
      }
    }
    return {
      caseId: c.id,
      report,
      judge: judged,
      latencyMs,
      costUsd: usage.reduce((a, u) => a + u.costUsd, 0),
      tokens: {
        input: usage.reduce((a, u) => a + u.inputTokens, 0),
        output: usage.reduce((a, u) => a + u.outputTokens, 0),
      },
      error: null,
    };
  } catch (err) {
    return {
      caseId: c.id,
      report: null,
      latencyMs: Date.now() - t0,
      costUsd: 0,
      tokens: { input: 0, output: 0 },
      error: {
        kind: err instanceof StructuredOutputError ? 'schema' : 'other',
        message: (err as Error).message,
      },
    };
  }
}

/** Run all cases with bounded concurrency, then score and gate. */
export async function runEvals(opts: {
  cases: EvalCase[];
  models: Models;
  /** LLM judge for question relevance; omit to leave that metric n/a. */
  judge?: LlmClient | null;
  concurrency?: number;
  onCaseDone?: (run: CaseRun, done: number, total: number) => void;
}): Promise<EvalRunResult> {
  const { cases, models, judge, concurrency = 3, onCaseDone } = opts;
  const runs: CaseRun[] = new Array(cases.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < cases.length) {
      const i = next++;
      runs[i] = await runCase(cases[i]!, models, judge);
      onCaseDone?.(runs[i]!, ++done, cases.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker));

  const byId = new Map(runs.map((r) => [r.caseId, r]));
  const scores = cases.map((c, i) =>
    scoreCase(c, runs[i]!, c.labels.injection ? byId.get(c.labels.injection.baseline) : undefined),
  );
  const metrics = aggregate(scores, runs);
  return { runs, scores, metrics, gate: checkGate(metrics, runs) };
}
