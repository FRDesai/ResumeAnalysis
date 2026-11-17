import { StructuredOutputError, type LlmClient, type Models, type StructuredRequest, type StructuredResult } from '../llm/types.js';

type Responder = (req: StructuredRequest<unknown>, callIndex: number) => unknown;

/**
 * Scripted LLM for tests and offline demos. Each step name maps to a function that
 * returns the raw JSON the "model" would produce; it is validated with the real Zod
 * schema, so a bad fixture fails like a bad model answer would.
 */
export class FakeLlm implements LlmClient {
  calls: { name: string; system: string; user: string }[] = [];
  constructor(
    public readonly model: string,
    private script: Record<string, Responder>,
  ) {}

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const idx = this.calls.filter((c) => c.name === req.name).length;
    this.calls.push({ name: req.name, system: req.system, user: req.user });
    const fn = this.script[req.name];
    if (!fn) throw new Error(`FakeLlm: no script for ${req.name}`);
    const data = req.schema.parse(fn(req as StructuredRequest<unknown>, idx));
    const problem = req.validate?.(data);
    if (problem) throw new StructuredOutputError(req.name, problem);
    return { data, usage: [{ model: this.model, inputTokens: 100, outputTokens: 50, costUsd: 0.001 }] };
  }
}

/** Defaults for steps a test doesn't care about; any test can override them. */
export const DEFAULT_SCRIPT: Record<string, Responder> = {
  guardCheck: () => ({ suspicious: [] }),
  rewriteBullets: () => ({ rewrites: [] }),
  generateQuestions: () => ({
    questions: Array.from({ length: 8 }, (_, i) => ({
      text: `Question ${i + 1}`,
      target: 'gap',
      requirementId: null,
      lineId: null,
      rubric: { one: 'weak', three: 'ok', five: 'strong' },
      probes: ['probe a', 'probe b'],
    })),
  }),
};

export function fakeModels(
  script: Record<string, Responder>,
): Models & { parse: FakeLlm; score: FakeLlm; all: FakeLlm[] } {
  const full = { ...DEFAULT_SCRIPT, ...script };
  const parse = new FakeLlm('fake-parse', full);
  const score = new FakeLlm('fake-score', full);
  return { parse, score, all: [parse, score] };
}
