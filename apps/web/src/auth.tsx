import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, type Me } from './api/client';

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** Use the current session, or start an anonymous one (data deleted after 7 days). */
  ensureSession: () => Promise<void>;
  login: (email: string, password: string, mode: 'login' | 'register') => Promise<void>;
  logout: () => void;
  deleteMyData: () => Promise<Record<string, number>>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [token, setTok] = useState(getToken());
  const meQuery = useQuery({
    queryKey: ['me', token],
    queryFn: () => api<Me>('/me'),
    enabled: !!token,
    retry: false,
  });

  const apply = useCallback(
    (t: string | null) => {
      setToken(t);
      setTok(t);
      qc.clear();
    },
    [qc],
  );

  const ensureSession = useCallback(async () => {
    if (getToken()) return;
    const r = await api<{ token: string }>('/auth/anonymous', { method: 'POST' });
    apply(r.token);
  }, [apply]);

  const login = useCallback(
    async (email: string, password: string, mode: 'login' | 'register') => {
      const r = await api<{ token: string }>(`/auth/${mode}`, { method: 'POST', json: { email, password } });
      apply(r.token);
    },
    [apply],
  );

  const deleteMyData = useCallback(async () => {
    const r = await api<{ deleted: Record<string, number> }>('/me', { method: 'DELETE' });
    apply(null);
    return r.deleted;
  }, [apply]);

  const value = useMemo<AuthState>(
    () => ({
      me: token ? (meQuery.data ?? null) : null,
      loading: !!token && meQuery.isLoading,
      ensureSession,
      login,
      logout: () => apply(null),
      deleteMyData,
    }),
    [token, meQuery.data, meQuery.isLoading, ensureSession, login, apply, deleteMyData],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
