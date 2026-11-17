import type { ZodType } from 'zod';

export interface LlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface StructuredRequest<T> {
  /** Name of the step, for tracing and error messages (e.g. "scoreDimensions"). */
  name: string;
  schema: ZodType<T>;
  system: string;
  user: string;
}

export interface StructuredResult<T> {
  data: T;
  /** One entry per API call (2 if the Zod retry was used). */
  usage: LlmUsage[];
}

/**
 * The only thing graph nodes know about a model. The real implementation wraps
 * LangChain; tests pass a scripted fake. This keeps the graph testable offline.
 */
export interface LlmClient {
  readonly model: string;
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

/** Model roles. The parse model is cheap; scoring needs a stronger one (PRD cost split). */
export interface Models {
  parse: LlmClient;
  score: LlmClient;
}

export class StructuredOutputError extends Error {
  constructor(
    public step: string,
    public issues: string,
  ) {
    super(`${step}: model output failed schema validation twice: ${issues}`);
  }
}

export class RefusalError extends Error {
  constructor(public step: string) {
    super(`${step}: the model declined to answer`);
  }
}
