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
    const ok = v === null ? 'not built yet' : (t.dir === 'min' ? v >= t.target : v <= t.target) ? 'pass' : '**FAIL**';
    const cmp = baseline ? `${delta(key, v, baseline.metrics[key])} | ` : '';
    lines.push(`| ${t.label} | ${fmt(v, t.unit)} | ${t.dir === 'min' ? '>=' : '<='} ${fmt(t.target, t.unit)} | ${cmp}${ok} |`);
  }

  const problems = result.scores.filter(
    (s) => s.error || s.requirements.misses.length || s.dimensions.misses.length || s.banned.length || (s.injection && !s.injection.passed),
  );
  if (problems.length) {
    lines.push('', '<details><summary>Per-case misses</summary>', '');
    for (const s of problems) {
      lines.push(`**${s.caseId}** (${s.category})`);
      if (s.error) lines.push(`- error: ${s.error}`);
      for (const m of s.requirements.misses) lines.push(`- requirement ${m}`);
      for (const m of s.dimensions.misses) lines.push(`- dimension ${m}`);
      for (const b of s.banned) lines.push(`- banned output: "${b}"`);
      if (s.injection && !s.injection.passed) lines.push(`- injection: ${s.injection.detail}`);
    }
    lines.push('', '</details>');
  }
  if (!result.gate.passed) lines.push('', '### Gate failures', ...result.gate.failures.map((f) => `- ${f}`));
  return lines.join('\n');
}
