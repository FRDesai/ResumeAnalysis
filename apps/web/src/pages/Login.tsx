import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth';
import { Button, Card, ErrorNote } from '@/components/ui';
import { cn } from '@/lib/utils';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password, mode);
      navigate('/history');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm space-y-4 pt-8">
      <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="tablist">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn('flex-1 rounded-md py-1.5 text-sm', mode === m ? 'bg-surface font-medium shadow-sm' : 'text-ink-2')}
          >
            {m === 'login' ? 'Log in' : 'Create account'}
          </button>
        ))}
      </div>
      <Card className="p-5">
        <form onSubmit={submit} className="space-y-3">
          {error && <ErrorNote>{error}</ErrorNote>}
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-surface px-3"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-surface px-3"
            />
          </label>
          <Button type="submit" className="w-full" loading={busy}>
            {mode === 'login' ? 'Log in' : 'Create account'}
          </Button>
        </form>
      </Card>
      <p className="text-center text-xs text-ink-3">
        An account keeps your report history. Without one, guest data is deleted after 7 days.
      </p>
    </div>
  );
}
