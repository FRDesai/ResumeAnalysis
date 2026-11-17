import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePdf } from '../../../packages/core/src/ingest/fixtures.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = createApp(
    loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'test-secret-at-least-16-chars' }),
  );
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
