import { fmt, THRESHOLDS, type MetricKey, type Metrics } from './metrics.js';
import type { EvalRunResult } from './runner.js';

function delta(key: MetricKey, now: number | null, before: number | null | undefined): string {
  if (now === null || before == null) return '';
  const d = now - before;
  if (Math.abs(d) < 1e-9) return '=';
  const unit = THRESHOLDS[key].unit;
  const better = THRESHOLDS[key].dir === 'min' ? d > 0 : d < 0;
  const s = unit === '%' ? `${(d * 100).toFixed(1)}pp` : unit === 's' ? `${(d / 1000).toFixed(1)}s` : unit === '$' ? `$${d.toFixed(4)}` : d.toFixed(2);
  return `${d > 0 ? '+' : ''}${s} ${better ? '(better)' : '(worse)'}`;
}

/** Markdown summary: used for the console, the GitHub job summary, and PRs. */
export function toMarkdown(
  result: EvalRunResult,
  meta: { datasetVersion: string; promptVersion: string; models: string; gitSha: string },
  baseline?: { metrics: Metrics; promptVersion: string; gitSha: string },
): string {
  const lines: string[] = [];
  lines.push(`## Eval results: ${result.gate.passed ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push(
    `Dataset \`${meta.datasetVersion}\` (${result.runs.length} cases) · prompts \`${meta.promptVersion}\` · ${meta.models} · \`${meta.gitSha.slice(0, 7)}\``,
  );
  if (baseline) lines.push(`Compared with baseline: prompts \`${baseline.promptVersion}\` at \`${baseline.gitSha.slice(0, 7)}\``);
  lines.push('');
  lines.push(`| Metric | Value | Threshold | ${baseline ? 'vs baseline | ' : ''}Status |`);
  lines.push(`| --- | --- | --- | ${baseline ? '--- | ' : ''}--- |`);
  for (const [key, t] of Object.entries(THRESHOLDS) as [MetricKey, (typeof THRESHOLDS)[MetricKey]][]) {
    const v = result.metrics[key];
    const ok = v === null ? 'not measured' : (t.dir === 'min' ? v >= t.target : v <= t.target) ? 'pass' : '**FAIL**';
    const cmp = baseline ? `${delta(key, v, baseline.metrics[key])} | ` : '';
    lines.push(`| ${t.label} | ${fmt(v, t.unit)} | ${t.dir === 'min' ? '>=' : '<='} ${fmt(t.target, t.unit)} | ${cmp}${ok} |`);
  }

  const sum = (fn: (s: (typeof result.scores)[number]) => number) => result.scores.reduce((a, s) => a + fn(s), 0);
  const proposed = sum((s) => s.rewrites.proposed);
  const rejected = sum((s) => s.rewrites.rejected);
  lines.push('');
  lines.push(
    `Rewrites: ${proposed} proposed, ${rejected} rejected by the entity check (${proposed ? ((rejected / proposed) * 100).toFixed(0) : 0}% of model rewrites invented a fact; users only see accepted ones).`,
  );

  // PRD: the judge is spot-checked by hand. Show the lowest-rated questions to read.
  const rated = result.runs.flatMap((r) => (r.judge?.ratings ?? []).map((x) => ({ ...x, caseId: r.caseId })));
  if (rated.length) {
    const low = [...rated].sort((a, b) => a.score - b.score).slice(0, 3);
    lines.push('', '<details><summary>Lowest-rated questions (spot-check the judge)</summary>', '');
    for (const q of low) lines.push(`- **${q.score}/5** ${q.caseId} ${q.id}: ${q.question}  \n  _judge: ${q.reason}_`);
    lines.push('', '</details>');
  }

  const problems = result.scores.filter(
    (s) =>
      s.error ||
      s.requirements.misses.length ||
      s.dimensions.misses.length ||
      s.banned.length ||
      s.rewrites.unfaithful.length ||
      (s.injection && !s.injection.passed),
  );
  if (problems.length) {
    lines.push('', '<details><summary>Per-case misses</summary>', '');
    for (const s of problems) {
      lines.push(`**${s.caseId}** (${s.category})`);
      if (s.error) lines.push(`- error: ${s.error}`);
      for (const m of s.requirements.misses) lines.push(`- requirement ${m}`);
      for (const m of s.dimensions.misses) lines.push(`- dimension ${m}`);
      for (const b of s.banned) lines.push(`- banned output: "${b}"`);
      for (const u of s.rewrites.unfaithful) lines.push(`- unfaithful rewrite shown to user: ${u}`);
      if (s.injection && !s.injection.passed) lines.push(`- injection: ${s.injection.detail}`);
    }
    lines.push('', '</details>');
  }
  if (!result.gate.passed) lines.push('', '### Gate failures', ...result.gate.failures.map((f) => `- ${f}`));
  return lines.join('\n');
}
