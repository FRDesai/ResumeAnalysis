import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { anthropicChat, LangChainLlm } from './langchain.js';
import { StructuredOutputError } from './types.js';

/**
 * A fake Anthropic SDK client: records each request body and replies with
 * scripted text. Lets us check the exact request LangChain sends to Claude,
 * offline, without an API key.
 */
function fakeClient(replies: string[]) {
  const requests: Record<string, unknown>[] = [];
  const create = async (body: Record<string, unknown>) => {
    requests.push(body);
    const text = replies[Math.min(requests.length - 1, replies.length - 1)]!;
    return {
      id: `msg_${requests.length}`,
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 100 },
    };
  };
  const client = { messages: { create }, beta: { messages: { create } } };
  return { requests, createClient: () => client };
}

const Schema = z.object({ score: z.number().int(), reason: z.string() });

describe('LangChainLlm (Anthropic request shape)', () => {
  it('uses native JSON-schema output + effort, and never sends temperature or a forced tool_choice', async () => {
    const f = fakeClient(['{"score": 4, "reason": "solid"}']);
    const llm = new LangChainLlm(anthropicChat('claude-sonnet-5-5', 'medium', f.createClient), 'claude-sonnet-5-5');
    const r = await llm.structured({ name: 'score', schema: Schema, system: 'sys', user: 'usr' });

    expect(r.data).toEqual({ score: 4, reason: 'solid' });
    const req = f.requests[0]!;
    expect(req.model).toBe('claude-sonnet-5-5');
    expect(req.output_config).toMatchObject({ effort: 'medium', format: { type: 'json_schema' } });
    expect(req).not.toHaveProperty('temperature');
    expect(req.tool_choice).toBeUndefined();
    expect(req.tools).toBeUndefined();
    // Server-side refusal fallback is on for Sonnet 5.5.
    expect(req.fallbacks).toBe('default');
    expect(req.betas).toContain('server-side-fallback-2026-07-01');
    // Usage and cost are tracked from the response.
    expect(r.usage[0]).toMatchObject({ inputTokens: 1000, outputTokens: 100 });
    expect(r.usage[0]!.costUsd).toBeCloseTo((1000 * 2 + 100 * 10) / 1e6);
  });

  it('does not send the fallback beta for Haiku', async () => {
    const f = fakeClient(['{"score": 1, "reason": "x"}']);
    const llm = new LangChainLlm(anthropicChat('claude-haiku-5-5', 'low', f.createClient), 'claude-haiku-5-5');
    await llm.structured({ name: 'p', schema: Schema, system: 's', user: 'u' });
    expect(f.requests[0]).not.toHaveProperty('fallbacks');
    expect(f.requests[0]!.output_config).toMatchObject({ effort: 'low' });
  });

  it('retries once with the Zod error as feedback, then succeeds', async () => {
    const f = fakeClient(['{"score": "four"}', '{"score": 4, "reason": "fixed"}']);
    const llm = new LangChainLlm(anthropicChat('claude-haiku-5-5', 'low', f.createClient), 'claude-haiku-5-5');
    const r = await llm.structured({ name: 'score', schema: Schema, system: 's', user: 'u' });
    expect(r.data.reason).toBe('fixed');
    expect(r.usage).toHaveLength(2);
    const retryMsgs = f.requests[1]!.messages as { role: string; content: unknown }[];
    expect(JSON.stringify(retryMsgs.at(-1))).toMatch(/failed validation: score/);
    expect(retryMsgs.at(-1)!.role).toBe('user'); // no assistant prefill
  });

  it('fails visibly after the retry also fails', async () => {
    const f = fakeClient(['not json', 'still not json']);
    const llm = new LangChainLlm(anthropicChat('claude-haiku-5-5', 'low', f.createClient), 'claude-haiku-5-5');
    await expect(llm.structured({ name: 'parseJD', schema: Schema, system: 's', user: 'u' })).rejects.toThrow(
      StructuredOutputError,
    );
    expect(f.requests).toHaveLength(2);
  });
});
