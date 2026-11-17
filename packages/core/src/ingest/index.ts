import { createHash } from 'node:crypto';
import { normalizeText, toLines, type Line } from './normalize.js';
import { countTokens, MAX_INPUT_TOKENS } from './tokens.js';

export * from './extract.js';
export * from './normalize.js';
export * from './tokens.js';

export class InputTooLargeError extends Error {
  constructor(public tokens: number) {
    super(`Input is ${tokens} tokens; the limit is ${MAX_INPUT_TOKENS}. Please shorten it.`);
  }
}

export class EmptyDocumentError extends Error {
  constructor() {
    super('No text could be extracted. Scanned image-only PDFs are not supported.');
  }
}

/** Content hash of normalised text, used for dedup and run idempotency keys. */
export function contentHash(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}

export interface PreparedDocument {
  rawText: string;
  lines: Line[];
  tokens: number;
  hash: string;
}

/** Normalise, line-ID, size-check and hash a document's text. Pure, no I/O. */
export function prepareDocument(text: string): PreparedDocument {
  const rawText = normalizeText(text);
  if (!rawText) throw new EmptyDocumentError();
  const tokens = countTokens(rawText);
  if (tokens > MAX_INPUT_TOKENS) throw new InputTooLargeError(tokens);
  return { rawText, lines: toLines(rawText), tokens, hash: contentHash(rawText) };
}
