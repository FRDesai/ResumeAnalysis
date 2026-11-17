import {
  EmptyDocumentError,
  InputTooLargeError,
  RefusalError,
  runAnalysis,
  StructuredOutputError,
  type AnalysisGraph,
  type ProgressEvent,
} from '@rm/core';
import { DocumentModel, ReportModel, Run, type RunEvent } from '@rm/db';
import { logger } from './logger.js';

export type Publish = (runId: string, e: RunEvent) => Promise<void>;

/** Errors that will fail again on retry: no point burning another attempt. */
export function isPermanent(err: unknown): boolean {
  return (
    err instanceof InputTooLargeError ||
    err instanceof EmptyDocumentError ||
    err instanceof StructuredOutputError ||
    err instanceof RefusalError
  );
}

/**
 * Run one analysis job. Safe to call again for the same run after a crash:
 * the graph resumes from its last Mongo checkpoint (thread_id = runId), and the
 * report write is an upsert keyed by runId.
 */
export async function processRun(runId: string, deps: { graph: AnalysisGraph; publish: Publish }) {
  const run = await Run.findById(runId);
  // Deleted (delete-my-data, or expired) while queued: nothing to do.
  if (!run) {
    logger.info({ runId }, 'run no longer exists; skipping');
    return;
  }
  if (run.status === 'done') return;

  let seq = run.events.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
  const emit = async (type: string, node?: string, data?: Record<string, unknown>) => {
    const e: RunEvent = { seq: ++seq, type, node, data, at: new Date().toISOString() };
    await Run.updateOne(
      { _id: runId },
      { $push: { events: { ...e, at: new Date(e.at) } }, ...(node ? { $set: { currentNode: node } } : {}) },
    );
    await deps.publish(runId, e);
  };

  const [resume, jd] = await Promise.all([DocumentModel.findById(run.resumeId), DocumentModel.findById(run.jdId)]);
  if (!resume || !jd) throw new EmptyDocumentError();

  await Run.updateOne({ _id: runId }, { $set: { status: 'running', startedAt: run.startedAt ?? new Date(), error: null } });

  // Resume from a checkpoint if a previous attempt got part-way through.
  const config = { configurable: { thread_id: runId } };
  const snapshot = await deps.graph.getState(config).catch(() => null);
  const resuming = !!snapshot && snapshot.next.length > 0;
  await emit(resuming ? 'run:resumed' : 'run:started', undefined, resuming ? { from: snapshot!.next } : undefined);

  const { report, usage } = await runAnalysis({
    graph: deps.graph,
    input: resuming ? null : { resumeLines: resume.lines as never, jdLines: jd.lines as never },
    threadId: runId,
    onEvent: (e: ProgressEvent) => emit(e.type, e.node, e.data),
  });

  const tokens = {
    input: usage.reduce((a, u) => a + u.inputTokens, 0),
    output: usage.reduce((a, u) => a + u.outputTokens, 0),
  };
  const costUsd = usage.reduce((a, u) => a + u.costUsd, 0);
  const createdAt = (run as unknown as { createdAt: Date }).createdAt;
  const latencyMs = Date.now() - createdAt.getTime();

  await ReportModel.updateOne(
    { runId },
    { $set: { ...report, runId, userId: run.userId, expiresAt: run.expiresAt ?? null } },
    { upsert: true },
  );
  await Run.updateOne(
    { _id: runId },
    { $set: { status: 'done', currentNode: null, tokens, costUsd, latencyMs, finishedAt: new Date() } },
  );
  await emit('run:done', undefined, { overall: report.overall, costUsd, latencyMs });
  logger.info({ runId, tokens, costUsd, latencyMs, overall: report.overall }, 'run done');
}

export async function markFailed(runId: string, err: unknown, publish: Publish) {
  const message = err instanceof Error ? err.message : String(err);
  const run = await Run.findByIdAndUpdate(
    runId,
    { $set: { status: 'failed', error: message, finishedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!run) return;
  const seq = run.events.reduce((m, e) => Math.max(m, e.seq ?? 0), 0) + 1;
  const e: RunEvent = { seq, type: 'run:failed', data: { error: message }, at: new Date().toISOString() };
  await Run.updateOne({ _id: runId }, { $push: { events: { ...e, at: new Date(e.at) } } });
  await publish(runId, e);
}
