import Anthropic from '@anthropic-ai/sdk';
import type { ConductorModel, ModelCallResult } from './model.js';

/** Models whose requests accept the server-side refusal fallback in its "default" form. */
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1']);

/**
 * The real Conductor model: one Messages API call with structured output (a JSON Schema the
 * reply must follow). Token usage comes back with every call so each run's cost is recorded.
 * A refusal or a cut-off reply is reported through stopReason; the runner decides what to do.
 *
 * The call is streamed: with thinking on, a reply can take minutes, and a non-streamed request
 * would hit the HTTP timeout. Only the final message is used.
 */
export class AnthropicConductorModel implements ConductorModel {
  readonly scripted = false;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly name: string,
    private readonly effort: 'low' | 'medium' | 'high',
    private readonly refusalFallback: 'default' | 'off' = 'default',
    /** Only tests set this, to talk to a local stand-in for the API. */
    baseURL?: string,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2, ...(baseURL ? { baseURL } : {}) });
  }

  async call(args: { system: string; user: string; schema: Record<string, unknown>; maxTokens: number }): Promise<ModelCallResult> {
    const fallback = this.refusalFallback === 'default' && FALLBACK_MODELS.has(this.name);
    const stream = this.client.beta.messages.stream(
      {
        model: this.name,
        max_tokens: args.maxTokens,
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
        output_config: { format: { type: 'json_schema', schema: args.schema }, effort: this.effort },
        // On a policy decline the API re-runs the request on a fallback model in the same call.
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      // The whole reply, thinking included, must arrive within 10 minutes.
      { signal: AbortSignal.timeout(10 * 60_000) },
    );
    const res = await stream.finalMessage();
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    let output: unknown = null;
    try {
      output = text ? JSON.parse(text) : null;
    } catch {
      output = null;
    }
    return {
      output,
      model: res.model,
      stopReason: res.stop_reason === 'end_turn' ? null : (res.stop_reason ?? null),
      usage: {
        input_tokens: res.usage.input_tokens ?? 0,
        output_tokens: res.usage.output_tokens ?? 0,
        cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: res.usage.cache_creation_input_tokens ?? 0,
        thinking_tokens: res.usage.output_tokens_details?.thinking_tokens ?? undefined,
      },
    };
  }
}
