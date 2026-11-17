import { modelNames, PROMPT_VERSION } from '@rm/core';
import { DocumentModel, Run, TERMINAL_EVENTS, type EventBus, type RunEvent } from '@rm/db';
import { createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { currentUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { logger } from '../logger.js';

const ObjectId = z.string().refine(isValidObjectId, 'Invalid id');
const StartRun = z.object({ resumeId: ObjectId, jdId: ObjectId });

/** Minimal queue surface (BullMQ Queue in prod, a fake in tests). */
export interface RunQueue {
  add(name: string, data: { runId: string }, opts?: { jobId?: string }): Promise<unknown>;
}

export interface RunDeps {
  queue: RunQueue;
  bus: EventBus;
  runsPerHour: number;
}

async function loadOwnRun(req: Request) {
  const user = currentUser(req);
  const id = String(req.params.id);
  if (!isValidObjectId(id)) throw new HttpError(404, 'Run not found');
  const run = await Run.findOne({ _id: id, userId: user.id });
  if (!run) throw new HttpError(404, 'Run not found');
  return run;
}

export function runsRouter(deps: RunDeps) {
  const r = Router();

  // PRD: 10 analyses per hour per user. Keyed by user ID, not IP.
  const startLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: deps.runsPerHour,
    keyGenerator: (req) => currentUser(req).id,
    message: { error: 'Run limit reached (10 per hour). Try again later.' },
  });

  /**
   * Start an analysis. Idempotent: the same resume + JD + prompt version + models
   * returns the existing run instead of paying for a new one.
   */
  r.post('/', startLimiter, async (req, res) => {
    const user = currentUser(req);
    const { resumeId, jdId } = StartRun.parse(req.body);
    const [resume, jd] = await Promise.all([
      DocumentModel.findOne({ _id: resumeId, userId: user.id, kind: 'resume' }),
      DocumentModel.findOne({ _id: jdId, userId: user.id, kind: 'jd' }),
    ]);
    if (!resume) throw new HttpError(404, 'Resume not found');
    if (!jd) throw new HttpError(404, 'Job description not found');

    const models = modelNames();
    const idemKey = createHash('sha256')
      .update([resume.hash, jd.hash, PROMPT_VERSION, models.parse, models.score].join('|'))
      .digest('hex');

    const existing = await Run.findOne({
      userId: user.id,
      idemKey,
      status: { $in: ['queued', 'running', 'done'] },
    }).sort({ createdAt: -1 });
    if (existing) {
      return res.json({ runId: existing.id, status: existing.status, cached: true });
    }

    const run = await Run.create({
      userId: user.id,
      resumeId,
      jdId,
      idemKey,
      promptVersion: PROMPT_VERSION,
      models: { parse: models.parse, score: models.score },
      expiresAt: user.expiresAt,
    });
    // jobId = runId: BullMQ ignores a duplicate add for the same job.
    await deps.queue.add('analyze', { runId: run.id }, { jobId: run.id });
    logger.info({ runId: run.id, userId: user.id }, 'run queued');
    res.status(202).json({ runId: run.id, status: run.status, cached: false });
  });

  r.get('/:id', async (req, res) => {
    const run = await loadOwnRun(req);
    res.json({
      runId: run.id,
      status: run.status,
      currentNode: run.currentNode,
      tokens: run.tokens,
      costUsd: run.costUsd,
      latencyMs: run.latencyMs,
      error: run.error,
      promptVersion: run.promptVersion,
      models: run.models,
      createdAt: (run as unknown as { createdAt: Date }).createdAt,
    });
  });

  /**
   * Server-Sent Events: replays stored progress, then streams live events from
   * Redis until the run finishes. Subscribes BEFORE reading history and drops
   * duplicates by sequence number, so no event is lost in between.
   */
  r.get('/:id/stream', async (req, res) => {
    const run = await loadOwnRun(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    let lastSeq = Number(req.headers['last-event-id']) || 0;
    let closed = false;
    let unsubscribe: (() => Promise<void>) | null = null;
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      void unsubscribe?.();
      res.end();
    };
    const send = (e: RunEvent) => {
      if (closed || e.seq <= lastSeq) return;
      lastSeq = e.seq;
      res.write(`id: ${e.seq}\nevent: progress\ndata: ${JSON.stringify(e)}\n\n`);
      if (TERMINAL_EVENTS.has(e.type)) close();
    };
    req.on('close', close);

    unsubscribe = await deps.bus.subscribe(run.id, send);
    if (closed) return void unsubscribe();

    const fresh = await Run.findById(run.id, { events: 1, status: 1 }).lean();
    for (const e of fresh?.events ?? []) send({ ...e, at: new Date(e.at!).toISOString() } as RunEvent);
    // A finished run whose terminal event was already seen by this client: just close.
    if (fresh && (fresh.status === 'done' || fresh.status === 'failed')) close();
  });

  return r;
}
