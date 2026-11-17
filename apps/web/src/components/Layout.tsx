import { FileSearch, History, LineChart, LogOut, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '@/auth';
import { cn, formatDate } from '@/lib/utils';
import { Button } from './ui';

const nav = [
  { to: '/', label: 'Analyze', icon: FileSearch, end: true },
  { to: '/history', label: 'History', icon: History, end: false },
  { to: '/evals', label: 'Evals', icon: LineChart, end: false },
];

function Account() {
  const { me, logout, deleteMyData } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!me) {
    return (
      <Link to="/login" className="text-sm font-medium text-ink-2 hover:text-ink">
        Log in
      </Link>
    );
  }

  const onDelete = async () => {
    const ok = window.confirm(
      'Delete all your data? This permanently removes your account, uploaded documents, reports and feedback. It cannot be undone.',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deleteMyData();
      navigate('/');
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <UserRound className="h-4 w-4" aria-hidden />
        <span className="max-w-40 truncate">{me.email ?? 'Guest'}</span>
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-border bg-surface p-3 shadow-lg">
          {me.anonymous && (
            <p className="mb-3 text-xs text-ink-2">
              Guest session. Everything you upload is deleted automatically on{' '}
              <strong>{me.expiresAt ? formatDate(me.expiresAt) : 'expiry'}</strong>.{' '}
              <Link to="/login" className="text-accent underline" onClick={() => setOpen(false)}>
                Create an account
              </Link>{' '}
              for permanent history.
            </p>
          )}
          <div className="flex flex-col gap-1">
            <Button variant="danger" size="sm" onClick={onDelete} loading={busy} className="justify-start">
              <Trash2 className="h-4 w-4" aria-hidden /> Delete my data
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => {
                logout();
                setOpen(false);
                navigate('/');
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden /> Log out
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:gap-6">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            ResumeMatch
          </Link>
          <nav className="flex items-center gap-1" aria-label="Main">
            {nav.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm',
                    isActive ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:text-ink',
                  )
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <Account />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
