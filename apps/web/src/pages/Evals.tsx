import { THRESHOLDS, fmt, type MetricKey } from '@rm/evals/thresholds';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError, type EvalRecord } from '@/api/client';
import { Badge, Card, ErrorNote, SectionTitle, Spinner, StatusBadge } from '@/components/ui';
import { formatDate } from '@/lib/utils';

interface EvalsResponse {
  latest: EvalRecord;
  history: EvalRecord[];
}

const DESCRIPTIONS: Record<MetricKey, string> = {
  evidenceValidity: 'Share of quotes found in the resume on the first try',
  requirementAccuracy: 'met / partial / missing vs hand labels',
  scoreAgreement: 'Dimension score within +/-1 of the hand label',
  injectionResistance: 'Injected instructions flagged and the score not inflated',
  rewriteFaithfulness: 'Rewrites shown to users that add no new facts',
  questionRelevance: 'LLM judge (a different model), 1-5',
  schemaValidity: 'Runs with no unrecovered output-format failure',
  bannedOutputFree: 'Cases with no invented facts from the banned list',
  latencyP95Ms: 'End-to-end, 95th percentile',
  costPerReportUsd: 'Mean model cost per report',
};

const passes = (key: MetricKey, v: number) => (THRESHOLDS[key].dir === 'min' ? v >= THRESHOLDS[key].target : v <= THRESHOLDS[key].target);

/** One metric over time: a single series, a dashed threshold, a hover tooltip per run. */
function TrendChart({ metric, history }: { metric: MetricKey; history: EvalRecord[] }) {
  const t = THRESHOLDS[metric];
  const pts = history.map((h, i) => ({ i, v: h.metrics[metric], h })).filter((p): p is typeof p & { v: number } => p.v != null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 320;
  const H = 120;
  const pad = { l: 40, r: 12, t: 10, b: 20 };
  if (pts.length === 0) {
    return <div className="flex h-[120px] items-center justify-center text-xs text-ink-3">Not measured yet</div>;
  }
  // Lines don't need a zero baseline: zoom to the data and the threshold, with labelled bounds.
  let lo = Math.min(t.target, ...pts.map((p) => p.v));
  let hi = Math.max(t.target, ...pts.map((p) => p.v));
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  lo -= span * 0.15;
  hi += span * 0.15;
  if (t.unit === '%') {
    lo = Math.max(0, lo);
    hi = Math.min(1, hi);
  }
  // Time and money cannot be negative: never pad the axis below zero.
  if (t.unit === 's' || t.unit === '$') lo = Math.max(0, lo);
  if (t.unit === 'score') {
    lo = Math.max(1, lo);
    hi = Math.min(5, hi);
  }
  const n = history.length;
  const x = (i: number) => pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const hovered = hover === null ? null : pts.find((p) => p.i === hover);
  const band = n === 1 ? W : (W - pad.l - pad.r) / (n - 1);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[120px] w-full" role="img" aria-label={`${t.label} over ${pts.length} runs`}>
        {/* recessive axis bounds */}
        <text x={pad.l - 6} y={pad.t + 4} textAnchor="end" className="fill-ink-3 text-[9px]">
          {fmt(hi, t.unit)}
        </text>
        <text x={pad.l - 6} y={H - pad.b} textAnchor="end" className="fill-ink-3 text-[9px]">
          {fmt(lo, t.unit)}
        </text>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--border)" />
        {/* threshold */}
        <line x1={pad.l} x2={W - pad.r} y1={y(t.target)} y2={y(t.target)} stroke="var(--text-3)" strokeDasharray="4 3" />
        <text x={W - pad.r} y={y(t.target) - 3} textAnchor="end" className="fill-ink-3 text-[9px]">
          threshold {fmt(t.target, t.unit)}
        </text>
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {pts.map((p) => (
          <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={hover === p.i ? 5 : 4} fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
        ))}
        {/* hit targets wider than the marks */}
        {history.map((_, i) => (
          <rect
            key={i}
            x={x(i) - band / 2}
            y={0}
            width={band}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-md"
          style={{ left: `${(x(hovered.i) / W) * 100}%`, top: 0, transform: 'translate(-50%, -105%)' }}
        >
          <div className="font-semibold">{fmt(hovered.v, t.unit)}</div>
          <div className="text-ink-2">
            prompts {hovered.h.promptVersion} · {hovered.h.gitSha.slice(0, 7)}
          </div>
          <div className="text-ink-3">{formatDate(hovered.h.createdAt)}</div>
        </div>
      )}
    </div>
  );
}

export function EvalsPage() {
  const q = useQuery({ queryKey: ['evals'], queryFn: () => api<EvalsResponse>('/evals/latest'), retry: false });

  const header = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Eval results</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-2">
        A hand-labelled golden set of resume and job pairs (including prompt-injection, keyword-stuffing and
        foreign-language cases) runs through the production pipeline on every pull request. The build fails if any
        metric drops below its threshold.
      </p>
    </div>
  );

  if (q.isLoading) return <Spinner label="Loading eval results" />;
  if (q.error) {
    const notYet = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="space-y-4">
        {header}
        {notYet ? (
          <Card className="p-5 text-sm text-ink-2">
            No eval results published yet. Run <code className="rounded bg-surface-2 px-1">pnpm evals --save</code>.
          </Card>
        ) : (
          <ErrorNote>{(q.error as Error).message}</ErrorNote>
        )}
      </div>
    );
  }
  const { latest, history } = q.data!;
  const keys = Object.keys(THRESHOLDS) as MetricKey[];

  return (
    <div className="space-y-6">
      {header}
      <Card className="flex flex-wrap items-center gap-3 p-4 text-sm">
        <StatusBadge status={latest.passed ? 'good' : 'bad'}>{latest.passed ? 'Gate passing' : 'Gate failing'}</StatusBadge>
        <span className="text-ink-2">
          Dataset {latest.datasetVersion}
          {latest.cases ? ` · ${latest.cases} cases` : ''} · prompts {latest.promptVersion} · {latest.model.parse} /{' '}
          {latest.model.score} · <code>{latest.gitSha.slice(0, 7)}</code> · {formatDate(latest.createdAt)}
        </span>
      </Card>

      <section>
        <SectionTitle>Latest run</SectionTitle>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-3">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium">Metric</th>
                <th className="px-4 py-2 font-medium">Value</th>
                <th className="px-4 py-2 font-medium">Threshold</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {keys.map((k) => {
                const v = latest.metrics[k] ?? null;
                const t = THRESHOLDS[k];
                return (
                  <tr key={k}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{t.label}</div>
                      <div className="text-xs text-ink-3">{DESCRIPTIONS[k]}</div>
                    </td>
                    <td className="px-4 py-2.5 font-mono">{fmt(v, t.unit)}</td>
                    <td className="px-4 py-2.5 font-mono text-ink-2">
                      {t.dir === 'min' ? '>=' : '<='} {fmt(t.target, t.unit)}
                    </td>
                    <td className="px-4 py-2.5">
                      {v === null ? (
                        <StatusBadge status="neutral">Not measured</StatusBadge>
                      ) : passes(k, v) ? (
                        <StatusBadge status="good">Pass</StatusBadge>
                      ) : (
                        <StatusBadge status="bad">Fail</StatusBadge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </section>

      <section>
        <SectionTitle hint={`Last ${history.length} runs, oldest to newest. Hover a point for its prompt version.`}>Trend per metric</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {keys.map((k) => (
            <Card key={k} className="p-3">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-medium">{THRESHOLDS[k].label}</h3>
                <Badge>{fmt(latest.metrics[k] ?? null, THRESHOLDS[k].unit)}</Badge>
              </div>
              <TrendChart metric={k} history={history} />
            </Card>
          ))}
        </div>
      </section>

      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">Table view of all runs</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-ink-3">
              <tr>
                <th className="py-1 pr-3">Date</th>
                <th className="py-1 pr-3">Prompts</th>
                <th className="py-1 pr-3">Commit</th>
                <th className="py-1 pr-3">Gate</th>
                {keys.map((k) => (
                  <th key={k} className="py-1 pr-3 font-medium">
                    {THRESHOLDS[k].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((h) => (
                <tr key={h._id} className="border-t border-border">
                  <td className="py-1 pr-3">{formatDate(h.createdAt)}</td>
                  <td className="py-1 pr-3">{h.promptVersion}</td>
                  <td className="py-1 pr-3 font-mono">{h.gitSha.slice(0, 7)}</td>
                  <td className="py-1 pr-3">{h.passed ? 'pass' : 'FAIL'}</td>
                  {keys.map((k) => (
                    <td key={k} className="py-1 pr-3 font-mono">
                      {fmt(h.metrics[k] ?? null, THRESHOLDS[k].unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
