/** USD per 1M tokens (input, output). Anthropic first-party rates. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};

/**
 * Cost of one call. Unknown models (e.g. OpenAI ones set via env) cost 0 here;
 * add them to the table or set PRICE_<MODEL>="in,out" to track them.
 */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const envKey = `PRICE_${model.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const fromEnv = process.env[envKey]?.split(',').map(Number);
  const p =
    fromEnv && fromEnv.length === 2 && fromEnv.every(Number.isFinite)
      ? { input: fromEnv[0]!, output: fromEnv[1]! }
      : PRICES[model];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
