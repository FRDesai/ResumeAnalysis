import { CheckCircle2, Circle, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { runStreamUrl, type RunEvent } from '@/api/client';
import { Card, ErrorNote } from '@/components/ui';
import { cn } from '@/lib/utils';

/** Graph nodes in display order, with plain-language labels. */
const STEPS: { node: string; label: string; detail: string }[] = [
  { node: 'ingest', label: 'Read documents', detail: 'Line IDs and size check, no AI' },
  { node: 'guard', label: 'Security scan', detail: 'Flag instructions hidden in the documents' },
  { node: 'parseResume', label: 'Parse resume', detail: 'Skills, roles, metrics' },
  { node: 'parseJD', label: 'Parse job description', detail: 'Must-have vs nice-to-have requirements' },
  { node: 'rewriteBullets', label: 'Suggest rewrites', detail: 'Runs in parallel; invented facts are rejected' },
  { node: 'matchRequirements', label: 'Match requirements', detail: 'Met / partial / missing, with quotes' },
  { node: 'scoreDimensions', label: 'Score 6 dimensions', detail: 'Rubric-anchored, 1 to 5' },
  { node: 'verifyEvidence', label: 'Verify every quote', detail: 'Code checks each quote is really in the resume' },
  { node: 'generateQuestions', label: 'Write interview questions', detail: 'Aimed at gaps and unproven claims' },
  { node: 'assembleReport', label: 'Assemble report', detail: 'Overall score computed in code' },
];

type StepState = 'pending' | 'done' | 'retry';

export function RunProgressPage() {
  const { runId = '' } = useParams();
  const navigate = useNavigate();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);

  useEffect(() => {
    const es = new EventSource(runStreamUrl(runId));
    es.addEventListener('progress', (msg) => {
      const e = JSON.parse((msg as MessageEvent).data) as RunEvent;
      setConnectionLost(false);
      setEvents((prev) => (prev.some((p) => p.seq === e.seq) ? prev : [...prev, e]));
      if (e.type === 'run:done') {
        es.close(); // otherwise EventSource reconnects after the server ends the stream
        setTimeout(() => navigate(`/reports/${runId}`, { replace: true }), 700);
      }
      if (e.type === 'run:failed') {
        es.close();
        setFailed(String(e.data?.error ?? 'The analysis failed.'));
      }
    });
    es.onerror = () => setConnectionLost(true); // EventSource retries on its own
    return () => es.close();
  }, [runId, navigate]);

  const state = useMemo(() => {
    const s: Record<string, StepState> = {};
    for (const e of events) {
      if (!e.node) continue;
      if (e.type === 'verifyEvidence:retry') s[e.node] = 'retry';
      else if (e.type.endsWith(':done')) s[e.node] = 'done';
    }
    return s;
  }, [events]);

  const retries = events.filter((e) => e.type === 'verifyEvidence:retry');
  const start = events[0] ? new Date(events[0].at).getTime() : null;
  const finished = events.some((e) => e.type === 'run:done');
  const doneCount = STEPS.filter((s) => state[s.node] === 'done').length;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Analyzing</h1>
        <p className="text-sm text-ink-2" aria-live="polite">
          {finished ? 'Done. Opening the report...' : failed ? 'Stopped.' : `${doneCount} of ${STEPS.length} steps complete`}
        </p>
      </div>

      {failed && (
        <ErrorNote>
          {failed}{' '}
          <Link to="/" className="underline">
            Start again
          </Link>
        </ErrorNote>
      )}
      {connectionLost && !failed && !finished && (
        <p className="text-xs text-ink-3">Connection interrupted, reconnecting. The analysis keeps running on the server.</p>
      )}

      <Card className="divide-y divide-border">
        {STEPS.map((step) => {
          const st = state[step.node] ?? 'pending';
          const doneEvent = [...events].reverse().find((e) => e.node === step.node && e.type.endsWith(':done'));
          const ms = doneEvent && start ? new Date(doneEvent.at).getTime() - start : null;
          return (
            <div key={step.node} className="flex items-center gap-3 px-4 py-3">
              {st === 'done' ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-good" aria-label="Done" />
              ) : st === 'retry' ? (
                <RotateCcw className="h-5 w-5 shrink-0 text-warn" aria-label="Retrying" />
              ) : failed ? (
                <XCircle className="h-5 w-5 shrink-0 text-ink-3" aria-label="Not run" />
              ) : events.length > 0 ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-ink-3" aria-label="Waiting" />
              ) : (
                <Circle className="h-5 w-5 shrink-0 text-ink-3" aria-label="Queued" />
              )}
              <div className="min-w-0 flex-1">
                <div className={cn('text-sm font-medium', st === 'pending' && 'text-ink-2')}>{step.label}</div>
                <div className="text-xs text-ink-3">{step.detail}</div>
              </div>
              {ms !== null && <span className="font-mono text-xs text-ink-3">{(ms / 1000).toFixed(1)}s</span>}
            </div>
          );
        })}
      </Card>

      {retries.length > 0 && (
        <Card className="border-warn/40 bg-warn-soft p-4 text-sm">
          <div className="flex items-center gap-2 font-medium text-warn">
            <RotateCcw className="h-4 w-4" aria-hidden /> The system caught itself
          </div>
          <ul className="mt-2 space-y-1 text-ink-2">
            {retries.map((r) => (
              <li key={r.seq}>
                A quote for <strong>{(r.data?.failed as string[] | undefined)?.join(', ')}</strong> was not found in your
                resume, so that score was sent back to be redone with real evidence.
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
