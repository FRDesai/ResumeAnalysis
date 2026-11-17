import { buildGraph, prepareDocument, runAnalysis, StructuredOutputError, type Models } from '@rm/core';
import type { EvalCase } from './dataset.js';
import { aggregate, checkGate, scoreCase, type CaseRun, type CaseScore, type GateResult, type Metrics } from './metrics.js';

export interface EvalRunResult {
  runs: CaseRun[];
  scores: CaseScore[];
  metrics: Metrics;
  gate: GateResult;
}

/** Run one case through the exact production graph (same prompts, same verifier). */
export async function runCase(c: EvalCase, models: Models): Promise<CaseRun> {
  const t0 = Date.now();
  try {
    const resume = prepareDocument(c.resume);
    const jd = prepareDocument(c.jd);
    const { report, usage } = await runAnalysis({
      graph: buildGraph(models),
      input: { resumeLines: resume.lines, jdLines: jd.lines },
      threadId: `eval-${c.id}-${t0}`,
    });
    return {
      caseId: c.id,
      report,
      latencyMs: Date.now() - t0,
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
  concurrency?: number;
  onCaseDone?: (run: CaseRun, done: number, total: number) => void;
}): Promise<EvalRunResult> {
  const { cases, models, concurrency = 3, onCaseDone } = opts;
  const runs: CaseRun[] = new Array(cases.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < cases.length) {
      const i = next++;
      runs[i] = await runCase(cases[i]!, models);
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
