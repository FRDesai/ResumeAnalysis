import { describe, expect, it } from 'vitest';
import { bestWindowSimilarity, verifyQuote } from './evidence.js';

const lines = [
  { id: 'L1', text: 'Priya Sharma' },
  { id: 'L5', text: '- Built payment APIs in Node.js and Express serving 2M requests/day' },
  { id: 'L6', text: '- Cut p95 latency by 40% by adding a Redis cache' },
];

describe('verifyQuote', () => {
  it('accepts an exact fragment of the cited line', () => {
    const r = verifyQuote({ lineId: 'L6', quote: 'Cut p95 latency by 40%' }, lines);
    expect(r).toMatchObject({ verified: true, lineId: 'L6', similarity: 1 });
  });

  it('tolerates case, curly quotes and bullet differences', () => {
    const r = verifyQuote({ lineId: 'L5', quote: 'built payment APIs in node.js and express' }, lines);
    expect(r.verified).toBe(true);
  });

  it('tolerates a tiny typo (>= 0.9 similarity)', () => {
    const r = verifyQuote({ lineId: 'L6', quote: 'Cut p95 latency by 40% by adding a Redis cach' }, lines);
    expect(r.verified).toBe(true);
    expect(r.similarity).toBeGreaterThanOrEqual(0.9);
  });

  it('rejects an invented number', () => {
    const r = verifyQuote({ lineId: 'L6', quote: 'Cut p95 latency by 75% using Memcached' }, lines);
    expect(r.verified).toBe(false);
  });

  it('rejects a paraphrase that is not in the resume', () => {
    const r = verifyQuote({ lineId: 'L5', quote: 'Led the payments platform team of 12' }, lines);
    expect(r.verified).toBe(false);
  });

  it('corrects a wrong line ID when the exact text is on another line', () => {
    const r = verifyQuote({ lineId: 'L1', quote: 'adding a Redis cache' }, lines);
    expect(r).toMatchObject({ verified: true, lineId: 'L6' });
  });

  it('rejects quotes too short to prove anything', () => {
    expect(verifyQuote({ lineId: 'L5', quote: 'Node' }, lines).verified).toBe(false);
  });

  it('rejects a non-existent line ID with invented text', () => {
    expect(verifyQuote({ lineId: 'L99', quote: 'Managed AWS budget of $2M' }, lines).verified).toBe(false);
  });
});

describe('bestWindowSimilarity', () => {
  it('is 1 for substrings', () => {
    expect(bestWindowSimilarity('redis cache', 'Cut latency with a Redis cache')).toBe(1);
  });
});
