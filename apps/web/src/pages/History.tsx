import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { api, type HistoryItem } from '@/api/client';
import { useAuth } from '@/auth';
import { Button, Card, ErrorNote, Spinner, StatusBadge } from '@/components/ui';
import { formatDate, scoreTone } from '@/lib/utils';

export function HistoryPage() {
  const { me } = useAuth();
  const q = useQuery({
    queryKey: ['history'],
    queryFn: () => api<{ items: HistoryItem[]; total: number }>('/reports?limit=50'),
    enabled: !!me,
  });

  const empty = (
    <Card className="flex flex-col items-start gap-3 p-6">
      <p className="text-sm text-ink-2">No reports yet.</p>
      <Link to="/">
        <Button>Analyze a resume</Button>
      </Link>
    </Card>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Your reports</h1>
      {!me ? (
        empty
      ) : q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote>{(q.error as Error).message}</ErrorNote>
      ) : !q.data?.items.length ? (
        empty
      ) : (
        <Card className="divide-y divide-border">
          {q.data.items.map((r) => {
            const tone = scoreTone(r.overall);
            return (
              <Link key={r.runId} to={`/reports/${r.runId}`} className="flex items-center gap-4 px-4 py-3 hover:bg-surface-2">
                <span className="w-12 text-right text-xl font-semibold">{r.overall ?? '-'}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.verdict}</div>
                  <div className="text-xs text-ink-3">
                    {formatDate(r.createdAt)} · {r.model.score} · prompts {r.promptVersion}
                  </div>
                </div>
                {tone !== 'none' && (
                  <StatusBadge status={tone}>{tone === 'good' ? 'Strong' : tone === 'warn' ? 'Partial' : 'Weak'}</StatusBadge>
                )}
                <ChevronRight className="h-4 w-4 text-ink-3" aria-hidden />
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
