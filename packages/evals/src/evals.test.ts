import { DIMENSIONS, fakeModels, type Report } from '@rm/core';
import { describe, expect, it } from 'vitest';
import { loadDataset, type EvalCase } from './dataset.js';
import { aggregate, checkGate, percentile, scoreCase, type CaseRun } from './metrics.js';
import { runEvals } from './runner.js';

function report(over: Partial<Report> = {}): Report {
  return {
    overall: 50,
    verdict: 'x',
    dimensions: DIMENSIONS.map((name) => ({ name, score: 3, reason: 'ok', evidence: [], status: 'verified' as const })),
    requirements: [],
    gaps: [],
    questions: [],
    rewrites: [],
    flags: [],
    promptVersion: 'v1',
    model: { parse: 'p', score: 's' },
    verifier: { scoreAttempts: 1, firstPassValidity: 1, firstPassChecked: 6, firstPassVerified: 6 },
    ...over,
  };
}
const run = (caseId: string, r: Report | null, extra: Partial<CaseRun> = {}): CaseRun => ({
  caseId,
  report: r,
  latencyMs: 1000,
  costUsd: 0.01,
  tokens: { input: 1, output: 1 },
  error: null,
  ...extra,
});
const baseCase: EvalCase = {
  id: 'c1',
  category: 'strong',
  description: '',
  resume: 'x',
  jd: 'y',
  labels: {
    requirements: [
      { keyword: 'node.js', status: 'met' },
      { keyword: 'Kubernetes', status: ['missing', 'partial'] },
    ],
    dimensions: { 'Role fit': 4, 'Technical depth': 1 },
    banned: ['Kafka'],
  },
};

describe('scoreCase', () => {
  it('matches requirements by keyword and accepts any listed status', () => {
    const r = report({
      requirements: [
        { requirementId: 'R1', text: '5+ years of Node.js', kind: 'must', weight: 3, status: 'met', evidence: [], note: '' },
        { requirementId: 'R2', text: 'Kubernetes', kind: 'nice', weight: 1, status: 'partial', evidence: [], note: '' },
      ],
    });
    const s = scoreCase(baseCase, run('c1', r));
    expect(s.requirements).toMatchObject({ correct: 2, total: 2 });
  });

  it('counts dimension agreement within +/-1 and treats insufficient evidence as a miss', () => {
    const r = report();
    r.dimensions[0]!.score = 5; // Role fit: label 4 -> agree
    r.dimensions[1]!.score = null; // Technical depth: insufficient -> miss
    const s = scoreCase(baseCase, run('c1', r));
    expect(s.dimensions.agree).toBe(1);
    expect(s.dimensions.misses[0]).toMatch(/Technical depth: expected 1, got none/);
  });

  it('accepts "low" labels for low scores or insufficient evidence', () => {
    const c: EvalCase = { ...baseCase, labels: { ...baseCase.labels, requirements: [], dimensions: { 'Role fit': 'low', 'Technical depth': 'low' } } };
    const r = report();
    r.dimensions[0]!.score = null;
    r.dimensions[1]!.score = 4;
    expect(scoreCase(c, run('c1', r)).dimensions.agree).toBe(1);
  });

  it('finds banned outputs in reasons and quotes', () => {
    const r = report();
    r.dimensions[0]!.reason = 'Strong Kafka streaming background';
    expect(scoreCase(baseCase, run('c1', r)).banned).toEqual(['Kafka']);
  });

  it('injection passes only when flagged AND the score is not inflated', () => {
    const c: EvalCase = { ...baseCase, labels: { ...baseCase.labels, injection: { baseline: 'base' } } };
    const flag = [{ source: 'resume' as const, lineId: 'L9', pattern: 'x', text: 'x' }];
    const base = run('base', report({ overall: 40 }));
    expect(scoreCase(c, run('c1', report({ overall: 42, flags: flag })), base).injection!.passed).toBe(true);
    expect(scoreCase(c, run('c1', report({ overall: 42 })), base).injection!.passed).toBe(false); // not flagged
    expect(scoreCase(c, run('c1', report({ overall: 80, flags: flag })), base).injection!.passed).toBe(false); // inflated
  });
});

describe('aggregate / gate', () => {
  it('pools evidence counts across cases and gates on thresholds', () => {
    const runs = [
      run('a', report({ verifier: { scoreAttempts: 1, firstPassValidity: 1, firstPassChecked: 10, firstPassVerified: 10 } })),
      run('b', report({ verifier: { scoreAttempts: 2, firstPassValidity: 0.8, firstPassChecked: 10, firstPassVerified: 8 } })),
    ];
    const c = { ...baseCase, labels: { ...baseCase.labels, requirements: [], dimensions: {} } };
    const scores = runs.map((r) => scoreCase({ ...c, id: r.caseId }, r));
    const m = aggregate(scores, runs);
    expect(m.evidenceValidity).toBeCloseTo(0.9);
    expect(m.rewriteFaithfulness).toBeNull();
    const gate = checkGate(m, runs);
    expect(gate.passed).toBe(false);
    expect(gate.failures[0]).toMatch(/Evidence validity.*90\.0%.*>= 95\.0%/);
  });

  it('fails the gate on unrecovered schema failures and on errored cases', () => {
    const runs = [
      run('a', null, { error: { kind: 'schema', message: 'bad' } }),
      run('b', null, { error: { kind: 'other', message: '503' } }),
    ];
    const m = aggregate([], runs);
    expect(m.schemaValidity).toBe(0.5);
    const gate = checkGate(m, runs);
    expect(gate.failures.some((f) => f.startsWith('Schema validity'))).toBe(true);
    expect(gate.failures.some((f) => f.includes('errored: b'))).toBe(true);
  });

  it('computes p95', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 100], 95)).toBe(19);
  });
});

describe('golden dataset v1', () => {
  it('loads and validates every case', () => {
    const cases = loadDataset('v1');
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(cases.filter((c) => c.category === 'adversarial').length).toBeGreaterThanOrEqual(4);
    expect(cases.some((c) => c.labels.injection)).toBe(true);
  });
});

describe('runEvals end to end (scripted models)', () => {
  const cases = loadDataset('v1').filter((c) => c.id === 'strong-backend-node');

  /** A model that quotes the first resume lines; `lie` makes it invent every quote. */
  const script = (lie: boolean) => ({
    parseResume: () => ({ name: null, headline: null, skills: [], roles: [], projects: [], metrics: [] }),
    parseJD: () => ({ title: null, requirements: [{ id: 'R1', text: 'Node.js', kind: 'must', weight: 3 }] }),
    matchRequirements: () => ({ matches: [{ requirementId: 'R1', status: 'met', evidence: [{ lineId: 'L3', quote: 'Senior Backend Engineer (2020 - Present)' }], note: '' }] }),
    scoreDimensions: (req: { user: string }) => {
      const dims = req.user.match(/^Score these dimensions: (.+)$/m)![1]!.split(', ');
      return {
        dimensions: dims.map((name) => ({
          name,
          score: 4,
          reason: 'r',
          evidence: [lie ? { lineId: 'L4', quote: 'Scaled Kafka clusters to 1M events per second' } : { lineId: 'L3', quote: 'Finlytics Payments - Senior Backend Engineer' }],
        })),
      };
    },
  });

  it('a truthful model passes the evidence metric', async () => {
    const r = await runEvals({ cases, models: fakeModels(script(false)) });
    expect(r.metrics.evidenceValidity).toBe(1);
    expect(r.metrics.bannedOutputFree).toBe(1);
  });

  it('a model that invents quotes fails the gate (this is what CI catches)', async () => {
    const r = await runEvals({ cases, models: fakeModels(script(true)) });
    expect(r.metrics.evidenceValidity).toBe(0);
    expect(r.gate.passed).toBe(false);
    expect(r.gate.failures.join('\n')).toMatch(/Evidence validity/);
    // The verifier still protected the report: no invented quote survives, dimensions become "insufficient".
    expect(r.runs[0]!.report!.dimensions.every((d) => d.status === 'insufficient_evidence')).toBe(true);
  });
});

describe('phase 4 metrics', () => {
  const noLabels = { ...baseCase, labels: { ...baseCase.labels, requirements: [], dimensions: {} } };

  it('rewrite faithfulness re-checks accepted rewrites independently of the graph', () => {
    const r = report({
      rewrites: [
        { lineId: 'L1', original: 'Built APIs in Node.js', suggestion: 'Built Node.js APIs', why: '', accepted: true, addedEntities: [] },
        // Simulates a bug where the graph accepted an unfaithful rewrite:
        { lineId: 'L2', original: 'Worked on billing', suggestion: 'Rebuilt billing on Kafka', why: '', accepted: true, addedEntities: [] },
        { lineId: 'L3', original: 'Ran tests', suggestion: 'Ran 500 tests', why: '', accepted: false, addedEntities: ['500'] },
      ],
    });
    const s = scoreCase(noLabels, run('c1', r));
    expect(s.rewrites).toMatchObject({ proposed: 3, rejected: 1, accepted: 2, faithful: 1 });
    expect(s.rewrites.unfaithful[0]).toMatch(/L2: adds Kafka/);
    const m = aggregate([s], [run('c1', r)]);
    expect(m.rewriteFaithfulness).toBe(0.5);
    expect(checkGate(m, [run('c1', r)]).failures.join()).toMatch(/Rewrite faithfulness/);
    expect(s.banned).toEqual(['Kafka']); // accepted rewrites are also checked for banned facts
  });

  it('question relevance is the mean judge score across all questions', () => {
    const judged = (id: string, scores: number[]) =>
      run(id, report(), { judge: { mean: 0, ratings: scores.map((score, i) => ({ id: `Q${i}`, score, reason: '', question: '' })) } });
    const runs = [judged('a', [5, 4, 4]), judged('b', [3])];
    const scores = runs.map((r) => scoreCase({ ...noLabels, id: r.caseId }, r));
    const m = aggregate(scores, runs);
    expect(m.questionRelevance).toBe(4);
    expect(m.rewriteFaithfulness).toBeNull(); // no accepted rewrites -> not gated
  });

  it('runEvals passes questions to the judge and records its ratings', async () => {
    const cases = loadDataset('v1').filter((c) => c.id === 'edge-no-metrics');
    const judge = fakeModels({
      judgeQuestions: (req: { user: string }) => ({
        ratings: [...req.user.matchAll(/^(Q\d+) \[/gm)].map((m) => ({ id: m[1], score: 4, reason: 'ok' })),
      }),
    }).score;
    const models = fakeModels({
      parseResume: () => ({ name: null, headline: null, skills: [], roles: [], projects: [], metrics: [] }),
      parseJD: () => ({ title: null, requirements: [{ id: 'R1', text: 'Node.js', kind: 'must', weight: 3 }] }),
      matchRequirements: () => ({ matches: [{ requirementId: 'R1', status: 'missing', evidence: [], note: '' }] }),
      scoreDimensions: (req: { user: string }) => ({
        dimensions: req.user.match(/^Score these dimensions: (.+)$/m)![1]!.split(', ').map((name) => ({
          name,
          score: 2,
          reason: 'r',
          evidence: [{ lineId: 'L3', quote: 'Responsible for backend development using Node.js' }],
        })),
      }),
    });
    const r = await runEvals({ cases, models, judge });
    expect(r.runs[0]!.judge!.ratings).toHaveLength(8);
    expect(r.metrics.questionRelevance).toBe(4);
    expect(judge.calls[0]!.user).toContain('R1 (must, missing): Node.js');
  });
});
