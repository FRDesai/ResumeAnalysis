import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.js';
import { logger } from './logger.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, HttpError } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { documentsRouter } from './routes/documents.js';
import { reportsRouter } from './routes/reports.js';
import { runsRouter, type RunDeps } from './routes/runs.js';

export type AppDeps = Omit<RunDeps, 'runsPerHour'> & { runsPerHour?: number };

export function createApp(config: Config, deps: AppDeps) {
  const app = express();
  const isTest = config.NODE_ENV === 'test';

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow non-browser clients (no Origin header) and the configured allow-list only.
        if (!origin || config.CORS_ORIGINS.includes(origin)) return cb(null, true);
        cb(new HttpError(403, 'Origin not allowed'));
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: !isTest,
      // Method, path (query string dropped: it can carry the SSE token) and status only.
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // Rate limits: tight on auth (brute force), looser on the rest of the API.
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: isTest ? 1000 : 20 });
  const apiLimiter = rateLimit({ windowMs: 15 * 60_000, limit: isTest ? 1000 : 300 });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authLimiter, authRouter(config));
  app.use('/api', apiLimiter, requireAuth(config.JWT_SECRET));
  app.use('/api/documents', documentsRouter());
  app.use('/api/runs', runsRouter({ runsPerHour: 10, ...deps }));
  app.use('/api/reports', reportsRouter());

  app.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use(errorHandler);
  return app;
}
