import { describe, expect, it } from 'vitest';
import { addedEntities, extractNames, extractNumbers } from './entities.js';

const ORIGINAL = '- Responsible for building REST APIs in Node.js for the payments team, 3,000 req/s';

describe('addedEntities', () => {
  it('accepts a rephrasing that only reuses facts from the original', () => {
    const rw = 'Built REST APIs in Node.js handling 3000 req/s for the payments team';
    expect(addedEntities(ORIGINAL, rw)).toEqual([]);
  });

  it('rejects an invented metric', () => {
    expect(addedEntities(ORIGINAL, 'Built REST APIs in Node.js, cutting latency by 40%')).toEqual(['40']);
  });

  it('rejects an invented tool', () => {
    expect(addedEntities(ORIGINAL, 'Built REST APIs in Node.js and Kafka for payments')).toEqual(['Kafka']);
  });

  it('rejects an invented employer or product name mid-sentence', () => {
    expect(addedEntities(ORIGINAL, 'Built Stripe-integrated REST APIs in Node.js')).toContain('Stripe-integrated');
    expect(addedEntities('Built payment APIs', 'Built payment APIs used by Google')).toEqual(['Google']);
  });

  it('rejects invented acronyms and symbol tools', () => {
    expect(addedEntities('Built APIs', 'Built APIs on AWS with C++')).toEqual(['AWS', 'C++']);
  });

  it('ignores capitalised sentence-initial verbs', () => {
    expect(addedEntities('responsible for the payments service', 'Owned the payments service. Improved it')).toEqual([]);
  });

  it('matches names case-insensitively and normalises number formats', () => {
    expect(addedEntities('used mongodb, 1,500 users', 'Scaled MongoDB to 1500 users')).toEqual([]);
  });
});

describe('extractors', () => {
  it('extracts numbers', () => {
    expect([...extractNumbers('$2.5M, 40%, 3,000 and 12.0')]).toEqual(['2.5', '40', '3000', '12']);
  });
  it('extracts name-like tokens', () => {
    expect(extractNames('Designed services in TypeScript on AWS using Node.js')).toEqual(['TypeScript', 'AWS', 'Node.js']);
  });
});
