import { describe, expect, it } from 'vitest';
import { makeDocx, makePdf } from './fixtures.js';
import {
  EmptyDocumentError,
  InputTooLargeError,
  extractText,
  normalizeText,
  prepareDocument,
  sniffMime,
  toLines,
  UnsupportedFileError,
} from './index.js';

describe('normalizeText', () => {
  it('collapses whitespace, unifies line endings and drops blank lines', () => {
    const raw = '  Jane   Doe \r\n\r\n\tSenior\u00A0Engineer\u200B \n\n\n';
    expect(normalizeText(raw)).toBe('Jane Doe\nSenior Engineer');
  });

  it('joins PDF-wrapped continuation lines back into one line', () => {
    const raw = [
      '- Designed and built REST APIs in Node.js and TypeScript for card payment',
      'processing, handling 3,000 requests per second',
      '- Involved in building order services in Node.js and Express backed by',
      'MongoDB',
      'Skills: Node.js, TypeScript, Express,',
      'Redis',
    ].join('\n');
    expect(normalizeText(raw).split('\n')).toEqual([
      '- Designed and built REST APIs in Node.js and TypeScript for card payment processing, handling 3,000 requests per second',
      '- Involved in building order services in Node.js and Express backed by MongoDB',
      'Skills: Node.js, TypeScript, Express, Redis',
    ]);
  });

  it('does not join new bullets, headings, or lines starting with names like iOS', () => {
    const raw = ['Experience', '- Built the payments API', '- Led the team', 'Skills:', 'iOS Developer', 'eBay (2019)'].join('\n');
    expect(normalizeText(raw).split('\n')).toHaveLength(6);
  });

  it('is idempotent', () => {
    const once = normalizeText(' a  b \n\n c ');
    expect(normalizeText(once)).toBe(once);
  });
});

describe('toLines', () => {
  it('assigns sequential IDs L1..Ln', () => {
    expect(toLines('first\nsecond\nthird')).toEqual([
      { id: 'L1', text: 'first' },
      { id: 'L2', text: 'second' },
      { id: 'L3', text: 'third' },
    ]);
  });

  it('returns no lines for empty input', () => {
    expect(toLines('')).toEqual([]);
  });
});

describe('prepareDocument', () => {
  it('returns the same hash for text that only differs in whitespace', () => {
    const a = prepareDocument('Built APIs  in Node.js\n\nLed a team of 4');
    const b = prepareDocument('  Built APIs in Node.js \r\nLed a team of 4  ');
    expect(a.hash).toBe(b.hash);
    expect(a.lines).toHaveLength(2);
  });

  it('rejects empty documents', () => {
    expect(() => prepareDocument(' \n\n ')).toThrow(EmptyDocumentError);
  });

  it('rejects input over 12k tokens before any LLM call', () => {
    const huge = 'word '.repeat(13_000);
    expect(() => prepareDocument(huge)).toThrow(InputTooLargeError);
  });
});

describe('sniffMime / extractText', () => {
  const lines = ['Jane Doe', 'Senior Backend Engineer', 'Reduced p95 latency by 40% using Redis'];

  it('extracts text from a PDF', async () => {
    const buf = await makePdf(lines);
    expect(sniffMime(buf)).toBe('application/pdf');
    const doc = prepareDocument(await extractText(buf));
    expect(doc.lines.map((l) => l.text)).toEqual(lines);
  });

  it('extracts text from a DOCX', async () => {
    const buf = await makeDocx(lines);
    expect(sniffMime(buf)).toContain('wordprocessingml');
    const doc = prepareDocument(await extractText(buf));
    expect(doc.lines.map((l) => l.text)).toEqual(lines);
  });

  it('rejects files that are not PDF or DOCX, whatever their name says', async () => {
    const fake = Buffer.from('MZ\x90\x00 this is an exe pretending to be resume.pdf');
    expect(sniffMime(fake)).toBeNull();
    await expect(extractText(fake)).rejects.toThrow(UnsupportedFileError);
  });
});
