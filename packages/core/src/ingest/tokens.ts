import { getEncoding, type Tiktoken } from 'js-tiktoken';

/** Hard limit from the PRD: reject inputs over 12k tokens before any LLM call. */
export const MAX_INPUT_TOKENS = 12_000;

let enc: Tiktoken | null = null;

/**
 * Token count using cl100k_base. It is not the exact tokenizer for every provider,
 * but it is close enough for a size guard, deterministic, and works offline.
 */
export function countTokens(text: string): number {
  enc ??= getEncoding('cl100k_base');
  return enc.encode(text).length;
}
