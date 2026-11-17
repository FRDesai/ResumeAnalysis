import { pino } from 'pino';

/** Worker logs carry runId, token counts and cost only: never resume or JD text. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'worker' },
});
