import { useQuery } from '@tanstack/react-query';
import { ChevronDown, FileText, ShieldAlert, Sparkles, Target } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type ReportResponse } from '@/api/client';
import { CopyButton, FeedbackButtons, ResumeView, ScorePips, ScoreRing, type Highlight } from '@/components/report/parts';
import { Badge, Card, ErrorNote, SectionTitle, Spinner, StatusBadge } from '@/components/ui';
import { wordDiff } from '@/lib/diff';
import { cn, formatDate } from '@/lib/utils';

type Tab = 'scores' | 'gaps' | 'rewrites';
type Selection = { kind: 'dimension' | 'requirement'; id: string };

const STATUS: Record<string, { tone: 'good' | 'warn' | 'bad'; label: string }> = {
  met: { tone: 'good', label: 'Met' },
  partial: { tone: 'warn', label: 'Partial' },
  missing: { tone: 'bad', label: 'Missing' },
};

function ScoresTab({ report }: { report: ReportResponse }) {
  const [sel, setSel] = useState<Selection>({ kind: 'dimension', id: report.dimensions[0]?.name ?? '' });

  const highlights: Highlight[] =
    sel.kind === 'dimension'
      ? (report.dimensions.find((d) => d.name === sel.id)?.evidence ?? [])
      : (report.requirements.find((r) => r.requirementId === sel.id)?.evidence ?? []);
  const selectedLabel =
    sel.kind === 'dimension' ? sel.id : report.requirements.find((r) => r.requirementId === sel.id)?.text;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <section>
          <SectionTitle hint="Select a score to see its evidence">Six dimensions</SectionTitle>
          <div className="grid gap-2">
            {report.dimensions.map((d) => {
              const active = sel.kind === 'dimension' && sel.id === d.name;
              const verified = d.evidence.filter((e) => e.verified).length;
              return (
                <div
                  key={d.name}
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  onClick={() => setSel({ kind: 'dimension', id: d.name })}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSel({ kind: 'dimension', id: d.name }))}
                  className={cn(
                    'cursor-pointer rounded-lg border p-3 text-left transition-colors',
                    active ? 'border-accent bg-accent-soft/50 ring-1 ring-accent' : 'border-border hover:bg-surface-2',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{d.name}</span>
                    <ScorePips score={d.score} />
                  </div>
                  <p className="mt-1 text-sm text-ink-2">{d.reason}</p>
                  <div className="mt-2 flex items-center justify-between">
                    {d.status === 'insufficient_evidence' ? (
                      <StatusBadge status="warn">Insufficient evidence: not scored</StatusBadge>
                    ) : (
                      <StatusBadge status="good">
                        {verified} verified quote{verified === 1 ? '' : 's'}
                      </StatusBadge>
                    )}
                    <FeedbackButtons report={report} targetType="dimension" targetId={d.name} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <SectionTitle hint="Select a requirement to see its evidence">Job requirements</SectionTitle>
          <Card className="divide-y divide-border">
            {report.requirements.map((r) => {
              const active = sel.kind === 'requirement' && sel.id === r.requirementId;
              const s = STATUS[r.status]!;
              return (
                <div
                  key={r.requirementId}
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  onClick={() => setSel({ kind: 'requirement', id: r.requirementId })}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSel({ kind: 'requirement', id: r.requirementId }))}
                  className={cn('flex cursor-pointer items-start gap-3 px-3 py-2.5', active ? 'bg-accent-soft/50' : 'hover:bg-surface-2')}
                >
                  <StatusBadge status={s.tone}>{s.label}</StatusBadge>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      {r.text} <span className="text-xs text-ink-3">({r.kind === 'must' ? 'must-have' : 'nice-to-have'})</span>
                    </div>
                    <div className="text-xs text-ink-3">{r.note}</div>
                  </div>
                  <FeedbackButtons report={report} targetType="requirement" targetId={r.requirementId} />
                </div>
              );
            })}
          </Card>
        </section>
      </div>

      <Card className="flex h-[min(78vh,760px)] flex-col overflow-hidden lg:sticky lg:top-20">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            <span className="truncate">
              Evidence for <strong>{selectedLabel}</strong>
            </span>
          </div>
          <Badge tone={highlights.some((h) => h.verified) ? 'good' : 'neutral'}>
            {highlights.filter((h) => h.verified).length} line(s)
          </Badge>
        </div>
        <ResumeView lines={report.resumeLines} highlights={highlights} />
      </Card>
    </div>
  );
}

function GapsTab({ report }: { report: ReportResponse }) {
  const [open, setOpen] = useState<string | null>(report.questions[0]?.id ?? null);
  const reqText = new Map(report.requirements.map((r) => [r.requirementId, r.text]));
  const lineText = new Map(report.resumeLines.map((l) => [l.id, l.text]));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section>
        <SectionTitle hint="Must-haves first">Gaps</SectionTitle>
        {report.gaps.length === 0 ? (
          <p className="text-sm text-ink-2">No gaps: every requirement has verified evidence.</p>
        ) : (
          <Card className="divide-y divide-border">
            {report.gaps.map((g) => (
              <div key={g.requirementId} className="flex items-start gap-3 px-3 py-2.5">
                <StatusBadge status={g.status === 'missing' ? 'bad' : 'warn'}>{g.status === 'missing' ? 'Missing' : 'Partial'}</StatusBadge>
                <div className="min-w-0">
                  <div className="text-sm">{g.text}</div>
                  <div className="text-xs text-ink-3">
                    {g.kind === 'must' ? 'Must-have' : 'Nice-to-have'} · {g.note}
                  </div>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section>
        <SectionTitle hint="Open a question for its rubric and follow-ups">Interview questions</SectionTitle>
        <div className="space-y-2">
          {report.questions.map((q) => {
            const isOpen = open === q.id;
            const about =
              q.target === 'gap' && q.requirementId
                ? `Probes gap: ${reqText.get(q.requirementId)}`
                : q.lineId
                  ? `Verifies claim on ${q.lineId}: "${lineText.get(q.lineId)}"`
                  : q.target === 'gap'
                    ? 'Probes a gap'
                    : 'Verifies a claim';
            return (
              <Card key={q.id} className={cn(isOpen && 'ring-1 ring-accent')}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : q.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-start gap-3 p-3 text-left"
                >
                  <span className="mt-0.5 font-mono text-xs text-ink-3">{q.id}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{q.text}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-ink-3">
                      {q.target === 'gap' ? <Target className="h-3 w-3" aria-hidden /> : <Sparkles className="h-3 w-3" aria-hidden />}
                      <span className="truncate">{about}</span>
                    </span>
                  </span>
                  <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-ink-3 transition-transform', isOpen && 'rotate-180')} aria-hidden />
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-border p-3 text-sm">
                    <div className="grid gap-2 sm:grid-cols-3">
                      {(
                        [
                          ['1', 'Weak', q.rubric.one],
                          ['3', 'Adequate', q.rubric.three],
                          ['5', 'Strong', q.rubric.five],
                        ] as const
                      ).map(([n, label, text]) => (
                        <div key={n} className="rounded-md bg-surface-2 p-2">
                          <div className="text-xs font-semibold text-ink-2">
                            {n}/5 · {label}
                          </div>
                          <div className="mt-1 text-xs text-ink-2">{text}</div>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-ink-2">Follow-up probes</div>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-2">
                        {q.probes.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex justify-end">
                      <FeedbackButtons report={report} targetType="question" targetId={q.id} />
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function RewritesTab({ report }: { report: ReportResponse }) {
  const accepted = report.rewrites.filter((r) => r.accepted);
  const rejected = report.rewrites.filter((r) => !r.accepted);
  return (
    <div className="max-w-3xl space-y-6">
      <section>
        <SectionTitle hint="Only facts already in each line are used">Suggested rewrites</SectionTitle>
        {accepted.length === 0 && <p className="text-sm text-ink-2">No safe rewrites were suggested for this resume.</p>}
        <div className="space-y-3">
          {accepted.map((w) => (
            <Card key={w.lineId} className="p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs text-ink-3">
                  {w.lineId} · {w.why}
                </span>
                <div className="flex items-center gap-1">
                  <CopyButton text={w.suggestion} />
                  <FeedbackButtons report={report} targetType="rewrite" targetId={w.lineId} />
                </div>
              </div>
              <p className="text-sm leading-relaxed">
                {wordDiff(w.original, w.suggestion).map((p, i) =>
                  p.type === 'same' ? (
                    <span key={i}>{p.text}</span>
                  ) : p.type === 'added' ? (
                    <ins key={i} className="rounded bg-good-soft px-0.5 text-good no-underline">
                      {p.text}
                    </ins>
                  ) : (
                    <del key={i} className="rounded bg-bad-soft px-0.5 text-bad">
                      {p.text}
                    </del>
                  ),
                )}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {rejected.length > 0 && (
        <details className="rounded-lg border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {rejected.length} rewrite{rejected.length > 1 ? 's' : ''} rejected for adding facts
          </summary>
          <p className="mt-2 text-xs text-ink-2">
            These suggestions added a number, tool or name that is not in your original line, so they were discarded and
            your original was kept.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {rejected.map((w) => (
              <li key={w.lineId}>
                <span className="text-ink-2">{w.original}</span>
                <div className="mt-0.5 text-xs text-bad">Would have added: {w.addedEntities.join(', ')}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function ReportPage() {
  const { runId = '' } = useParams();
  const [tab, setTab] = useState<Tab>('scores');
  const q = useQuery({ queryKey: ['report', runId], queryFn: () => api<ReportResponse>(`/reports/${runId}`) });

  if (q.isLoading) return <Spinner label="Loading report" />;
  if (q.error || !q.data) {
    return (
      <ErrorNote>
        {(q.error as Error)?.message ?? 'Report not found.'}{' '}
        <Link to={`/runs/${runId}`} className="underline">
          View progress
        </Link>
      </ErrorNote>
    );
  }
  const r = q.data;
  const mustMissing = r.gaps.filter((g) => g.kind === 'must' && g.status === 'missing').length;
  const resumeFlags = r.flags.filter((f) => f.source === 'resume');

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'scores', label: 'Scores & evidence' },
    { id: 'gaps', label: 'Gaps & questions', count: r.questions.length },
    { id: 'rewrites', label: 'Rewrites', count: r.rewrites.filter((w) => w.accepted).length },
  ];

  return (
    <div className="space-y-6">
      <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <ScoreRing value={r.overall} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{r.verdict}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge status={mustMissing ? 'bad' : 'good'}>
              {mustMissing ? `${mustMissing} must-have gap${mustMissing > 1 ? 's' : ''}` : 'All must-haves covered'}
            </StatusBadge>
            <Badge>
              Quotes verified on first try: {Math.round(r.verifier.firstPassValidity * 100)}%
            </Badge>
            {r.verifier.scoreAttempts > 1 && <Badge tone="warn">Rescored {r.verifier.scoreAttempts - 1}x after failed quotes</Badge>}
          </div>
          <p className="mt-2 text-xs text-ink-3">
            {formatDate(r.createdAt)} · {r.model.score} · prompts {r.promptVersion} · overall is a weighted average computed in
            code, not by the model
          </p>
        </div>
      </Card>

      {resumeFlags.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm" role="note">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
          <div>
            <div className="font-medium">Instructions aimed at the AI were found in this resume and ignored</div>
            <ul className="mt-1 text-xs text-ink-2">
              {resumeFlags.map((f) => (
                <li key={f.lineId}>
                  {f.lineId}: "{f.text}"
                </li>
              ))}
            </ul>
            <div className="mt-1 text-xs text-ink-2">They were treated as plain text and did not change any score.</div>
          </div>
        </div>
      )}

      <div role="tablist" className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === t.id ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 text-xs text-ink-3">{t.count}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'scores' && <ScoresTab report={r} />}
        {tab === 'gaps' && <GapsTab report={r} />}
        {tab === 'rewrites' && <RewritesTab report={r} />}
      </div>
    </div>
  );
}
