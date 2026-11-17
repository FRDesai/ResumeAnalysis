import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type FeedbackTarget, type Line, type ReportResponse, type Vote } from '@/api/client';
import { cn, scoreTone } from '@/lib/utils';

export interface Highlight {
  lineId: string;
  quote: string;
  verified: boolean;
}

/** 1-5 score as five pips plus the number (the number carries the value; pips are decoration). */
export function ScorePips({ score }: { score: number | null }) {
  if (score === null) return <span className="text-sm text-ink-3">n/a</span>;
  return (
    <span className="inline-flex items-center gap-2" aria-label={`${score} out of 5`}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cn('h-2 w-4 rounded-sm', i <= score ? 'bg-accent' : 'bg-surface-3')} />
        ))}
      </span>
      <span className="font-mono text-sm font-semibold">{score}/5</span>
    </span>
  );
}

/** Overall 0-100 as a ring. The label (not the color) says the band. */
export function ScoreRing({ value }: { value: number | null }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(value);
  const stroke = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', none: 'var(--text-3)' }[tone];
  return (
    <div className="relative h-24 w-24 shrink-0" role="img" aria-label={value === null ? 'No overall score' : `Overall ${value} out of 100`}>
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="7" />
        {value !== null && (
          <circle cx="40" cy="40" r={r} fill="none" stroke={stroke} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold">{value ?? '-'}</span>
        <span className="text-[10px] uppercase tracking-wide text-ink-3">of 100</span>
      </div>
    </div>
  );
}

/** The resume, line by line, with the selected evidence highlighted and scrolled into view. */
export function ResumeView({ lines, highlights }: { lines: Line[]; highlights: Highlight[] }) {
  const container = useRef<HTMLOListElement>(null);
  const byLine = new Map<string, Highlight[]>();
  for (const h of highlights) byLine.set(h.lineId, [...(byLine.get(h.lineId) ?? []), h]);
  const firstId = highlights.find((h) => h.verified)?.lineId;

  useEffect(() => {
    if (!firstId || !container.current) return;
    const el = container.current.querySelector<HTMLElement>(`[data-line="${firstId}"]`);
    if (!el) return;
    const top = el.offsetTop - container.current.offsetTop - 80;
    container.current.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [firstId, highlights]);

  const unverified = highlights.filter((h) => !h.verified);

  return (
    <div className="flex h-full flex-col">
      <ol ref={container} className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[12.5px] leading-relaxed">
        {lines.map((l) => {
          const hs = byLine.get(l.id)?.filter((h) => h.verified);
          return (
            <li
              key={l.id}
              data-line={l.id}
              className={cn('flex gap-3 rounded px-1.5 py-0.5', hs?.length && 'bg-good-soft ring-1 ring-good/30')}
            >
              <span className="w-8 shrink-0 select-none text-right text-ink-3">{l.id}</span>
              <span className="whitespace-pre-wrap break-words">{l.text}</span>
              {hs?.length ? <Check className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 text-good" aria-label="Verified evidence" /> : null}
            </li>
          );
        })}
      </ol>
      {unverified.length > 0 && (
        <div className="border-t border-border bg-bad-soft px-3 py-2 text-xs text-bad">
          <div className="font-medium">Not found in the resume (ignored):</div>
          {unverified.map((u, i) => (
            <div key={i} className="mt-0.5 line-through decoration-bad/60">
              {u.lineId}: "{u.quote}"
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Thumbs up/down that remembers the user's vote. Downvotes feed the eval dataset. */
export function FeedbackButtons({
  report,
  targetType,
  targetId,
}: {
  report: ReportResponse;
  targetType: FeedbackTarget;
  targetId: string;
}) {
  const qc = useQueryClient();
  const current = report.votes.find((v) => v.targetType === targetType && v.targetId === targetId)?.vote;
  const [vote, setVote] = useState<Vote | undefined>(current);
  const m = useMutation({
    mutationFn: (v: Vote) =>
      api(`/reports/${report.runId}/feedback`, { method: 'POST', json: { targetType, targetId, vote: v } }),
    onMutate: (v) => setVote(v),
    onError: () => setVote(current),
    onSettled: () => qc.invalidateQueries({ queryKey: ['report', report.runId] }),
  });
  const btn = (v: Vote, Icon: typeof ThumbsUp, label: string) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        m.mutate(v);
      }}
      aria-pressed={vote === v}
      aria-label={label}
      title={label}
      className={cn(
        'rounded p-1 transition-colors hover:bg-surface-2',
        vote === v ? (v === 'up' ? 'text-good' : 'text-bad') : 'text-ink-3',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
  return (
    <span className="inline-flex items-center">
      {btn('up', ThumbsUp, 'Helpful')}
      {btn('down', ThumbsDown, 'Not helpful')}
    </span>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked: the text is still selectable */
        }
      }}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-good" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
