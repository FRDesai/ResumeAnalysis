import { MemorySaver } from '@langchain/langgraph';
import { buildGraph, DIMENSIONS, fakeModels, prepareDocument, StructuredOutputError } from '@rm/core';
import { DocumentModel, ReportModel, Run, type RunEvent } from '@rm/db';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPermanent, markFailed, processRun } from './processRun.js';

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

const RESUME = 'Priya Sharma\nSenior Backend Engineer, Acme Payments (2021-2024)\n- Built payment APIs in Node.js and Express';
const JD = 'Senior Backend Engineer\nMust have: Node.js';

function script(opts: { failMatchOnce?: boolean } = {}) {
  let matchCalls = 0;
  return {
    parseResume: () => ({ name: 'Priya', headline: null, skills: [], roles: [], projects: [], metrics: [] }),
    parseJD: () => ({ title: 'SBE', requirements: [{ id: 'R1', text: 'Node.js', kind: 'must', weight: 3 }] }),
    matchRequirements: () => {
      if (opts.failMatchOnce && matchCalls++ === 0) throw new Error('simulated worker crash / provider outage');
      return {
        matches: [{ requirementId: 'R1', status: 'met', evidence: [{ lineId: 'L3', quote: 'Built payment APIs in Node.js' }], note: 'ok' }],
      };
    },
    scoreDimensions: () => ({
      dimensions: DIMENSIONS.map((name) => ({
        name,
        score: 3,
        reason: 'r',
        evidence: [{ lineId: 'L2', quote: 'Senior Backend Engineer, Acme Payments' }],
      })),
    }),
  };
}

async function makeRun() {
  const userId = new mongoose.Types.ObjectId();
  const r = prepareDocument(RESUME);
  const j = prepareDocument(JD);
  const resume = await DocumentModel.create({ userId, kind: 'resume', ...r });
  const jd = await DocumentModel.create({ userId, kind: 'jd', ...j });
  return Run.create({
    userId,
    resumeId: resume._id,
    jdId: jd._id,
    idemKey: `k-${Math.random()}`,
    promptVersion: 'v1',
    models: { parse: 'fake-parse', score: 'fake-score' },
  });
}

describe('processRun', () => {
  it('runs the graph, stores the report, and records tokens/cost/latency and events', async () => {
    const run = await makeRun();
    const published: RunEvent[] = [];
    const graph = buildGraph(fakeModels(script()), new MemorySaver());
    await processRun(run.id, { graph, publish: async (_id, e) => void published.push(e) });

    const done = await Run.findById(run.id).lean();
    expect(done).toMatchObject({ status: 'done', tokens: { input: 400, output: 200 } });
    expect(done!.costUsd).toBeCloseTo(0.004);
    expect(done!.latencyMs).toBeGreaterThanOrEqual(0);

    const report = await ReportModel.findOne({ runId: run.id }).lean();
    expect(report!.overall).toBe(50);

    const types = published.map((e) => e.type);
    expect(types[0]).toBe('run:started');
    expect(types.at(-1)).toBe('run:done');
    expect(published.map((e) => e.seq)).toEqual(published.map((_, i) => i + 1));
    expect(done!.events).toHaveLength(published.length);
  });

  it('resumes from the checkpoint after a crash without re-running finished nodes', async () => {
    const run = await makeRun();
    const models = fakeModels(script({ failMatchOnce: true }));
    const graph = buildGraph(models, new MemorySaver()); // same checkpointer across attempts
    const publish = async () => {};

    await expect(processRun(run.id, { graph, publish })).rejects.toThrow('simulated');
    expect((await Run.findById(run.id))!.status).toBe('running');

    // Attempt 2 (what BullMQ's retry does):
    const events: RunEvent[] = [];
    await processRun(run.id, { graph, publish: async (_id, e) => void events.push(e) });

    expect(events[0]).toMatchObject({ type: 'run:resumed', data: { from: ['matchRequirements'] } });
    // parseResume and parseJD ran exactly once in total: their results came from the checkpoint.
    expect(models.parse.calls.map((c) => c.name).sort()).toEqual(['parseJD', 'parseResume']);
    expect((await Run.findById(run.id))!.status).toBe('done');
    // Sequence numbers continue after the first attempt's events, so SSE clients don't drop them.
    expect(events[0]!.seq).toBeGreaterThan(1);
  });

  it('marks a run failed with a terminal event', async () => {
    const run = await makeRun();
    const published: RunEvent[] = [];
    await markFailed(run.id, new StructuredOutputError('scoreDimensions', 'bad'), async (_id, e) => void published.push(e));
    const failed = await Run.findById(run.id).lean();
    expect(failed).toMatchObject({ status: 'failed' });
    expect(failed!.error).toContain('scoreDimensions');
    expect(published[0]!.type).toBe('run:failed');
    expect(isPermanent(new StructuredOutputError('x', 'y'))).toBe(true);
    expect(isPermanent(new Error('ECONNRESET'))).toBe(false);
  });
});
