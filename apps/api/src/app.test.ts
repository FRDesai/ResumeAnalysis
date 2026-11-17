import { ReportModel, Run, type EventBus, type RunEvent } from '@rm/db';
import { EventEmitter } from 'node:events';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePdf } from '../../../packages/core/src/ingest/fixtures.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;

/** In-memory stand-ins for BullMQ and Redis pub/sub. */
const queued: string[] = [];
const fakeQueue = { add: async (_n: string, d: { runId: string }) => void queued.push(d.runId) };
const emitter = new EventEmitter();
const fakeBus: EventBus = {
  async subscribe(runId, onEvent) {
    const h = (e: RunEvent) => onEvent(e);
    emitter.on(runId, h);
    return async () => void emitter.off(runId, h);
  },
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = createApp(loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'test-secret-at-least-16-chars' }), {
    queue: fakeQueue,
    bus: fakeBus,
    runsPerHour: 3,
  });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

async function registerAndToken(email = `u${Date.now()}${Math.random()}@x.io`) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'correct-horse' })
    .expect(201);
  return res.body.token as string;
}

describe('auth', () => {
  it('registers, rejects duplicates, logs in, and rejects bad passwords', async () => {
    await request(app).post('/api/auth/register').send({ email: 'a@b.co', password: 'password123' }).expect(201);
    await request(app).post('/api/auth/register').send({ email: 'A@b.co', password: 'password123' }).expect(409);
    const ok = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'password123' }).expect(200);
    expect(ok.body.token).toBeTypeOf('string');
    await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'wrong-pass' }).expect(401);
  });

  it('validates input', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'nope', password: 'x' }).expect(400);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it('protects /api/documents', async () => {
    await request(app).post('/api/documents').send({ kind: 'jd', text: 'x' }).expect(401);
  });
});

describe('POST /api/documents', () => {
  it('uploads a resume PDF and returns line-numbered text', async () => {
    const token = await registerAndToken();
    const pdf = await makePdf(['Jane Doe', 'Built payment APIs in Node.js serving 2M req/day']);
    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pdf, { filename: 'resume.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(res.body.kind).toBe('resume');
    expect(res.body.lines).toEqual([
      { id: 'L1', text: 'Jane Doe' },
      { id: 'L2', text: 'Built payment APIs in Node.js serving 2M req/day' },
    ]);
  });

  it('dedupes the same content for the same user', async () => {
    const token = await registerAndToken();
    const send = (text: string) =>
      request(app).post('/api/documents').set('Authorization', `Bearer ${token}`).send({ kind: 'jd', text });
    const first = await send('Must have: Node.js\nNice to have: AWS').expect(201);
    const second = await send('  Must have:   Node.js \n\nNice to have: AWS ').expect(200);
    expect(second.body.documentId).toBe(first.body.documentId);
    expect(second.body.deduped).toBe(true);
  });

  it('rejects a non-PDF file even when it claims to be one', async () => {
    const token = await registerAndToken();
    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('not a pdf at all'), { filename: 'cv.pdf', contentType: 'application/pdf' })
      .expect(415);
  });

  it('rejects files over 5 MB', async () => {
    const token = await registerAndToken();
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x20);
    await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', big, { filename: 'big.pdf' })
      .expect(413);
  });

  it('rejects text over 12k tokens with a clear message', async () => {
    const token = await registerAndToken();
    const res = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'jd', text: 'requirement '.repeat(13_000) })
      .expect(413);
    expect(res.body.error).toMatch(/limit is 12000/);
  });
});

// ---------------- runs, reports, SSE ----------------

async function setupDocs() {
  const token = await registerAndToken();
  const auth = { Authorization: `Bearer ${token}` };
  const pdf = await makePdf(['Jane Doe', 'Built payment APIs in Node.js serving 2M req/day']);
  const resume = await request(app).post('/api/documents').set(auth).attach('file', pdf, 'cv.pdf').expect(201);
  const jd = await request(app).post('/api/documents').set(auth).send({ kind: 'jd', text: 'Must have: Node.js' }).expect(201);
  return { token, auth, resumeId: resume.body.documentId as string, jdId: jd.body.documentId as string };
}

/** Collect an SSE response body as text (supertest buffers until the server ends it). */
const sseText = (req: request.Test) =>
  req.buffer(true).parse((res, cb) => {
    let d = '';
    res.on('data', (c: Buffer) => (d += c.toString()));
    res.on('end', () => cb(null, d));
  });

describe('POST /api/runs', () => {
  it('queues a run and is idempotent for the same inputs', async () => {
    const { auth, resumeId, jdId } = await setupDocs();
    const first = await request(app).post('/api/runs').set(auth).send({ resumeId, jdId }).expect(202);
    expect(queued).toContain(first.body.runId);
    const again = await request(app).post('/api/runs').set(auth).send({ resumeId, jdId }).expect(200);
    expect(again.body).toMatchObject({ runId: first.body.runId, cached: true });

    const status = await request(app).get(`/api/runs/${first.body.runId}`).set(auth).expect(200);
    expect(status.body).toMatchObject({ status: 'queued', promptVersion: 'v1' });
  });

  it("rejects another user's documents and swapped kinds", async () => {
    const a = await setupDocs();
    const b = await setupDocs();
    await request(app).post('/api/runs').set(b.auth).send({ resumeId: a.resumeId, jdId: b.jdId }).expect(404);
    await request(app).post('/api/runs').set(a.auth).send({ resumeId: a.jdId, jdId: a.resumeId }).expect(404);
  });

  it('rate-limits runs per user', async () => {
    const { auth, resumeId, jdId } = await setupDocs();
    // runsPerHour is 3 in this test app; cached responses still count as requests.
    for (let i = 0; i < 3; i++) await request(app).post('/api/runs').set(auth).send({ resumeId, jdId });
    await request(app).post('/api/runs').set(auth).send({ resumeId, jdId }).expect(429);
  });
});

describe('GET /api/runs/:id/stream (SSE)', () => {
  it('replays stored events, then streams live ones until run:done', async () => {
    const { auth, resumeId, jdId } = await setupDocs();
    const { body } = await request(app).post('/api/runs').set(auth).send({ resumeId, jdId }).expect(202);
    const runId = body.runId as string;
    await Run.updateOne(
      { _id: runId },
      { $set: { status: 'running' }, $push: { events: { seq: 1, type: 'run:started', at: new Date() } } },
    );

    const pending = sseText(request(app).get(`/api/runs/${runId}/stream`).set(auth));
    // Publish live events shortly after the client has connected.
    setTimeout(() => {
      const at = new Date().toISOString();
      emitter.emit(runId, { seq: 1, type: 'run:started', at }); // duplicate of history: dropped
      emitter.emit(runId, { seq: 2, type: 'parseResume:done', node: 'parseResume', at });
      emitter.emit(runId, { seq: 3, type: 'run:done', at });
    }, 150);
    const res = await pending;
    expect(res.headers['content-type']).toContain('text/event-stream');
    const types = [...(res.body as string).matchAll(/"type":"([^"]+)"/g)].map((m) => m[1]);
    expect(types).toEqual(['run:started', 'parseResume:done', 'run:done']);
  });

  it('accepts ?access_token= for EventSource clients and closes finished runs immediately', async () => {
    const { token, auth, resumeId, jdId } = await setupDocs();
    const { body } = await request(app).post('/api/runs').set(auth).send({ resumeId, jdId });
    await Run.updateOne(
      { _id: body.runId },
      { $set: { status: 'done' }, $push: { events: { seq: 1, type: 'run:done', at: new Date() } } },
    );
    const res = await sseText(request(app).get(`/api/runs/${body.runId}/stream?access_token=${token}`));
    expect(res.status).toBe(200);
    expect(res.body).toContain('run:done');
    // The query-token fallback is only for /stream:
    await request(app).get(`/api/runs/${body.runId}?access_token=${token}`).expect(401);
  });
});

describe('reports', () => {
  it('returns 409 while running, the report when done, and lists history', async () => {
    const { auth, resumeId, jdId } = await setupDocs();
    const { body } = await request(app).post('/api/runs').set(auth).send({ resumeId, jdId });
    await request(app).get(`/api/reports/${body.runId}`).set(auth).expect(409);

    const run = await Run.findById(body.runId);
    await ReportModel.create({
      runId: run!._id,
      userId: run!.userId,
      overall: 72,
      verdict: 'Good fit with gaps',
      promptVersion: 'v1',
      model: { parse: 'p', score: 's' },
    });
    const rep = await request(app).get(`/api/reports/${body.runId}`).set(auth).expect(200);
    expect(rep.body.overall).toBe(72);
    const list = await request(app).get('/api/reports?limit=5').set(auth).expect(200);
    expect(list.body).toMatchObject({ total: 1, page: 1, limit: 5 });
  });

  it("does not leak another user's report", async () => {
    const a = await setupDocs();
    const b = await setupDocs();
    const { body } = await request(app).post('/api/runs').set(a.auth).send({ resumeId: a.resumeId, jdId: a.jdId });
    await request(app).get(`/api/reports/${body.runId}`).set(b.auth).expect(404);
  });
});
