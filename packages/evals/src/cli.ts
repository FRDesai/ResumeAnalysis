/**
 * Eval CLI.
 *
 *   pnpm evals                      run datasets/v1 with the configured models
 *   pnpm evals --cases a,b          only some cases
 *   pnpm evals --save               also write the result to MongoDB (evalResults)
 *   pnpm evals --write-baseline     store this run as the baseline future runs compare against
 *   pnpm evals --summary FILE       append the markdown summary to FILE (GitHub job summary)
 *
 * Exits 1 when any metric misses its threshold, which fails the CI job.
 */
import { createModels, modelNames, PROMPT_VERSION } from '@rm/core';
import { EvalResultModel } from '@rm/db';
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { loadDataset } from './dataset.js';
import { createJudge } from './judge.js';
import { toMarkdown } from './format.js';
import type { Metrics } from './metrics.js';
import { runEvals } from './runner.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'baseline.json');

const { values: args } = parseArgs({
  options: {
    dataset: { type: 'string', default: 'v1' },
    cases: { type: 'string' },
    concurrency: { type: 'string', default: '3' },
    save: { type: 'boolean', default: false },
    'write-baseline': { type: 'boolean', default: false },
    summary: { type: 'string' },
  },
});

function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

let cases = loadDataset(args.dataset);
if (args.cases) {
  const want = new Set(args.cases.split(','));
  // Keep injection baselines so injection cases can be scored.
  for (const c of cases) if (want.has(c.id) && c.labels.injection) want.add(c.labels.injection.baseline);
  cases = cases.filter((c) => want.has(c.id));
}

const names = modelNames();
const meta = {
  datasetVersion: args.dataset!,
  promptVersion: PROMPT_VERSION,
  models: `${names.parse} / ${names.score}`,
  gitSha: gitSha(),
};
const judge = createJudge();
console.log(
  `Running ${cases.length} cases · prompts ${meta.promptVersion} · ${meta.models} · judge: ${judge?.model ?? 'none (question relevance n/a)'}\n`,
);

const result = await runEvals({
  cases,
  models: createModels(),
  judge,
  concurrency: Number(args.concurrency),
  onCaseDone: (r, done, total) =>
    console.log(
      `  [${done}/${total}] ${r.caseId.padEnd(28)} ${r.error ? `ERROR ${r.error.message.slice(0, 80)}` : `overall=${r.report?.overall ?? '-'}  ${(r.latencyMs / 1000).toFixed(1)}s  $${r.costUsd.toFixed(4)}`}`,
    ),
});

const baseline = existsSync(BASELINE)
  ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as { metrics: Metrics; promptVersion: string; gitSha: string })
  : undefined;
const md = toMarkdown(result, meta, baseline);
console.log(`\n${md}\n`);

const record = {
  ...meta,
  model: { parse: names.parse, score: names.score },
  passed: result.gate.passed,
  failures: result.gate.failures,
  metrics: result.metrics,
  perCase: result.scores,
  cases: cases.length,
  createdAt: new Date().toISOString(),
};
writeFileSync(join(ROOT, 'results', 'latest.json'), JSON.stringify({ ...record, runs: result.runs }, null, 2));
if (args.summary) appendFileSync(args.summary, `${md}\n`);
if (args['write-baseline']) {
  writeFileSync(BASELINE, JSON.stringify({ metrics: result.metrics, promptVersion: meta.promptVersion, gitSha: meta.gitSha, models: meta.models, createdAt: record.createdAt }, null, 2) + '\n');
  console.log(`Baseline written to ${BASELINE}`);
}
if (args.save) {
  await mongoose.connect(process.env.MONGO_URI ?? 'mongodb://localhost:27017/resumematch');
  await EvalResultModel.create(record);
  await mongoose.disconnect();
  console.log('Saved to evalResults');
}

process.exit(result.gate.passed ? 0 : 1);
