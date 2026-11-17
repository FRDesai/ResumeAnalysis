import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const ANALYSIS_QUEUE = 'analysis';

export interface AnalysisJob {
  runId: string;
}

/** BullMQ needs maxRetriesPerRequest=null on its connections. */
export function redisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function createAnalysisQueue(url: string): Queue<AnalysisJob> {
  return new Queue<AnalysisJob>(ANALYSIS_QUEUE, {
    connection: redisConnection(url),
    defaultJobOptions: {
      // A failed attempt is retried; the graph resumes from its Mongo checkpoint.
      attempts: 2,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  });
}

// ---------- progress events (Redis pub/sub) ----------

export interface RunEvent {
  seq: number;
  type: string;
  node?: string;
  data?: Record<string, unknown>;
  at: string;
}

export const runChannel = (runId: string) => `run:${runId}:events`;

/** Event types after which no more events will arrive for a run. */
export const TERMINAL_EVENTS = new Set(['run:done', 'run:failed']);

/** Small interface so the API can be tested without Redis. */
export interface EventBus {
  subscribe(runId: string, onEvent: (e: RunEvent) => void): Promise<() => Promise<void>>;
}

export class RedisEventBus implements EventBus {
  constructor(private url: string) {}

  async subscribe(runId: string, onEvent: (e: RunEvent) => void) {
    // Each SSE connection gets its own subscriber connection (a subscribed client
    // can't run other commands). Fine at this scale.
    const sub = new Redis(this.url);
    sub.on('message', (_ch, msg) => {
      try {
        onEvent(JSON.parse(msg) as RunEvent);
      } catch {
        /* ignore malformed messages */
      }
    });
    await sub.subscribe(runChannel(runId));
    return async () => {
      await sub.unsubscribe().catch(() => {});
      sub.disconnect();
    };
  }
}
