import type {
  DimensionName,
  InterviewQuestion,
  Report,
  Rewrite,
} from '@rm/core/schemas';

export type { DimensionName, InterviewQuestion, Report, Rewrite };

export interface Line {
  id: string;
  text: string;
}

export type FeedbackTarget = 'dimension' | 'question' | 'requirement' | 'rewrite';
export type Vote = 'up' | 'down';

export interface ReportResponse extends Report {
  runId: string;
  createdAt: string;
  resumeLines: Line[];
  jdLines: Line[];
  votes: { targetType: FeedbackTarget; targetId: string; vote: Vote }[];
}

export interface DocumentResponse {
  documentId: string;
  kind: 'resume' | 'jd';
  tokens: number;
  lines: Line[];
  deduped: boolean;
}

export interface RunStatus {
  runId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  currentNode: string | null;
  tokens: { input: number; output: number };
  costUsd: number;
  latencyMs: number | null;
  error: string | null;
  promptVersion: string;
  models: { parse: string; score: string };
}

export interface RunEvent {
  seq: number;
  type: string;
  node?: string;
  data?: Record<string, unknown>;
  at: string;
}

export interface HistoryItem {
  runId: string;
  overall: number | null;
  verdict: string;
  promptVersion: string;
  model: { parse: string; score: string };
  createdAt: string;
}

export interface EvalRecord {
  _id: string;
  datasetVersion: string;
  promptVersion: string;
  model: { parse: string; score: string };
  gitSha: string;
  passed: boolean;
  failures?: string[];
  metrics: Record<string, number | null>;
  createdAt: string;
  cases?: number;
}

export interface Me {
  id: string;
  email: string | null;
  anonymous: boolean;
  expiresAt: string | null;
}

const TOKEN_KEY = 'rm.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session lasts until reload */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Fetch JSON from the API with the bearer token. Throws ApiError with the server's message. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) setToken(null);
    throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** EventSource can't send headers, so the SSE route accepts the token as a query param. */
export function runStreamUrl(runId: string): string {
  return `/api/runs/${runId}/stream?access_token=${encodeURIComponent(getToken() ?? '')}`;
}
