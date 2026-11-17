import { FileUp, Play, ShieldCheck } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, type DocumentResponse, type Line } from '@/api/client';
import { useAuth } from '@/auth';
import { Badge, Button, Card, ErrorNote, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';

const MAX_BYTES = 5 * 1024 * 1024;

function LinePreview({ lines }: { lines: Line[] }) {
  return (
    <ol className="max-h-80 overflow-auto rounded-lg border border-border bg-surface-2 p-2 font-mono text-xs leading-relaxed">
      {lines.map((l) => (
        <li key={l.id} className="flex gap-3">
          <span className="w-8 shrink-0 select-none text-right text-ink-3">{l.id}</span>
          <span className="whitespace-pre-wrap break-words">{l.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function UploadPage() {
  const { ensureSession } = useAuth();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [resume, setResume] = useState<(DocumentResponse & { name: string }) | null>(null);
  const [jdText, setJdText] = useState('');
  const [jd, setJd] = useState<DocumentResponse | null>(null);
  const [busy, setBusy] = useState<'resume' | 'jd' | 'run' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const uploadResume = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) return setError('That file is larger than 5 MB.');
    setBusy('resume');
    try {
      await ensureSession();
      const form = new FormData();
      form.append('file', file);
      const doc = await api<DocumentResponse>('/documents', { method: 'POST', body: form });
      setResume({ ...doc, name: file.name });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) void uploadResume(f);
  };

  const saveJd = async () => {
    setError(null);
    setBusy('jd');
    try {
      await ensureSession();
      setJd(await api<DocumentResponse>('/documents', { method: 'POST', json: { kind: 'jd', text: jdText } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    if (!resume || !jd) return;
    setError(null);
    setBusy('run');
    try {
      const run = await api<{ runId: string; status: string }>('/runs', {
        method: 'POST',
        json: { resumeId: resume.documentId, jdId: jd.documentId },
      });
      navigate(run.status === 'done' ? `/reports/${run.runId}` : `/runs/${run.runId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">How well does this resume fit the job?</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          Every score in the report comes with the exact resume line behind it, checked by code to really be there.
          You also get likely interview questions and safer bullet rewrites.
        </p>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle hint="PDF or DOCX, up to 5 MB">1. Resume</SectionTitle>
          {!resume ? (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              disabled={busy === 'resume'}
              className={cn(
                'flex h-48 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm transition-colors',
                dragging ? 'border-accent bg-accent-soft' : 'border-border hover:border-accent/60 hover:bg-surface-2',
              )}
            >
              <FileUp className="h-6 w-6 text-ink-3" aria-hidden />
              <span className="font-medium">{busy === 'resume' ? 'Reading your resume...' : 'Drop your resume here or click to browse'}</span>
              <span className="text-xs text-ink-3">The file is read in memory and never stored.</span>
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-medium">{resume.name}</span>
                <div className="flex items-center gap-2">
                  <Badge>{resume.lines.length} lines</Badge>
                  <Button variant="ghost" size="sm" onClick={() => setResume(null)}>
                    Change
                  </Button>
                </div>
              </div>
              <p className="text-xs text-ink-2">This is exactly what the model reads. Evidence quotes cite these line IDs.</p>
              <LinePreview lines={resume.lines} />
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadResume(f);
              e.target.value = '';
            }}
          />
        </Card>

        <Card className="p-5">
          <SectionTitle hint="Paste the job description text">2. Job description</SectionTitle>
          {!jd ? (
            <div className="space-y-3">
              <label htmlFor="jd" className="sr-only">
                Job description
              </label>
              <textarea
                id="jd"
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                placeholder={'Senior Backend Engineer\nMust have: 5+ years of Node.js\nNice to have: Kubernetes'}
                className="h-48 w-full resize-y rounded-lg border border-border bg-surface p-3 text-sm placeholder:text-ink-3"
              />
              <Button variant="secondary" onClick={saveJd} disabled={!jdText.trim()} loading={busy === 'jd'}>
                Use this job description
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Job description</span>
                <div className="flex items-center gap-2">
                  <Badge>{jd.lines.length} lines</Badge>
                  <Button variant="ghost" size="sm" onClick={() => setJd(null)}>
                    Edit
                  </Button>
                </div>
              </div>
              <LinePreview lines={jd.lines} />
            </div>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={analyze} disabled={!resume || !jd} loading={busy === 'run'} className="h-11 px-6">
          <Play className="h-4 w-4" aria-hidden /> Analyze fit
        </Button>
        <p className="flex items-center gap-1.5 text-xs text-ink-3">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Instructions hidden in a resume are flagged and ignored. No account needed: guest data is deleted after 7 days.
        </p>
      </div>
    </div>
  );
}
