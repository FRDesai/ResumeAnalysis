import { pino } from 'pino';

/**
 * Structured logger. Privacy rule from the PRD: never log resume or JD text,
 * only IDs and hashes. Request bodies are never logged, and auth headers are redacted.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.rawText', '*.text'],
  ...(process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});
