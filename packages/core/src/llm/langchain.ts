import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { createDemoModels } from './demo.js';
import { costUsd } from './pricing.js';
import {
  RefusalError,
  StructuredOutputError,
  type LlmClient,
  type LlmUsage,
  type Models,
  type StructuredRequest,
  type StructuredResult,
} from './types.js';

type Effort = 'low' | 'medium' | 'high';

function textOf(msg: BaseMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .map((b) =>
      typeof b === 'object' && b && 'text' in b && typeof b.text === 'string' ? b.text : '',
    )
    .join('');
}

/**
 * Wrap a LangChain chat model as an LlmClient.
 *
 * - Structured output uses the provider's native JSON-schema mode (method "jsonSchema").
 *   Not tool calling: current Claude models reject a forced tool_choice.
 * - We validate with Zod ourselves (instead of LangChain's parser, which hides the
 *   error) so the one retry can tell the model exactly what was wrong.
 * - HTTP 429/5xx/timeouts are retried with exponential backoff by the provider SDK
 *   (maxRetries), configured where the model is built.
 */
export class LangChainLlm implements LlmClient {
  constructor(
    private chat: BaseChatModel,
    public readonly model: string,
  ) {}

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const runnable = this.chat.withStructuredOutput(req.schema, {
      name: req.name,
      method: 'jsonSchema',
      includeRaw: true,
    });

    const messages: BaseMessage[] = [new SystemMessage(req.system), new HumanMessage(req.user)];
    const usage: LlmUsage[] = [];
    let lastIssues = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
      const { raw } = (await runnable.invoke(messages, { runName: req.name })) as {
        raw: AIMessage;
      };
      const u = raw.usage_metadata;
      usage.push({
        model: this.model,
        inputTokens: u?.input_tokens ?? 0,
        outputTokens: u?.output_tokens ?? 0,
        costUsd: costUsd(this.model, u?.input_tokens ?? 0, u?.output_tokens ?? 0),
      });
      if (raw.response_metadata?.stop_reason === 'refusal') throw new RefusalError(req.name);

      const text = textOf(raw);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (e) {
        lastIssues = `invalid JSON (${(e as Error).message})`;
        json = undefined;
      }
      if (json !== undefined) {
        const parsed = req.schema.safeParse(json);
        if (parsed.success) return { data: parsed.data, usage };
        lastIssues = parsed.error.issues
          .slice(0, 10)
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
      }
      // One automatic retry with the validation error as feedback (PRD failure-mode table).
      messages.push(
        new AIMessage(text || '(empty)'),
        new HumanMessage(
          `Your previous output failed validation: ${lastIssues}. Return the full corrected JSON object only.`,
        ),
      );
    }
    throw new StructuredOutputError(req.name, lastIssues);
  }
}

export interface ModelEnv {
  LLM_PROVIDER?: string;
  PARSE_MODEL?: string;
  SCORE_MODEL?: string;
  OPENAI_PARSE_MODEL?: string;
  OPENAI_SCORE_MODEL?: string;
}

export function anthropicChat(
  model: string,
  effort: Effort,
  createClient?: (opts: unknown) => unknown,
): BaseChatModel {
  // Claude Sonnet 5.5 / Haiku 5.5 reject non-default temperature, so determinism comes
  // from rubric anchors, structured output and a fixed effort level instead.
  const serverFallback = model === 'claude-sonnet-5-5';
  return new ChatAnthropic({
    model,
    maxTokens: 16_000,
    outputConfig: { effort },
    clientOptions: { maxRetries: 3, timeout: 120_000 },
    ...(createClient ? { createClient: createClient as never, apiKey: 'test' } : {}),
    // If a safety classifier declines, the API re-runs the request on a fallback
    // model inside the same call. (Not available for Haiku.)
    ...(serverFallback
      ? { betas: ['server-side-fallback-2026-07-01'], invocationKwargs: { fallbacks: 'default' } }
      : {}),
  }) as unknown as BaseChatModel;
}

function openai(model: string, temperature: number): BaseChatModel {
  return new ChatOpenAI({ model, temperature, maxRetries: 3, timeout: 120_000 });
}

/** Model IDs that createModels would use, without constructing clients (no API key needed). */
export function modelNames(env: ModelEnv = process.env): {
  provider: string;
  parse: string;
  score: string;
} {
  if (env.LLM_PROVIDER === 'fake')
    return { provider: 'fake', parse: 'demo-offline', score: 'demo-offline' };
  if (env.LLM_PROVIDER === 'openai') {
    return {
      provider: 'openai',
      parse: env.OPENAI_PARSE_MODEL ?? 'gpt-4.1-mini',
      score: env.OPENAI_SCORE_MODEL ?? 'gpt-4.1',
    };
  }
  return {
    provider: 'anthropic',
    parse: env.PARSE_MODEL ?? 'claude-haiku-5-5',
    score: env.SCORE_MODEL ?? 'claude-sonnet-5-5',
  };
}

/** Build the parse/score model pair from env. Anthropic is the default provider. */
export function createModels(env: ModelEnv = process.env): Models {
  const { provider, parse, score } = modelNames(env);
  if (provider === 'fake') return createDemoModels();
  if (provider === 'openai') {
    return {
      parse: new LangChainLlm(openai(parse, 0), parse),
      score: new LangChainLlm(openai(score, 0), score),
    };
  }
  return {
    parse: new LangChainLlm(anthropicChat(parse, 'low'), parse),
    score: new LangChainLlm(anthropicChat(score, 'medium'), score),
  };
}
