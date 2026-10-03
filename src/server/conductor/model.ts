/**
 * The Conductor's model, behind an interface so tests and the rehearsal can script it.
 * The real implementation (anthropic.ts) calls the Anthropic API with structured output.
 */
export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface ModelCallResult {
  /** The raw JSON object the model returned (validated by the caller). */
  output: unknown;
  usage: ModelUsage;
  model: string;
  /** Set when the model declined (stop_reason "refusal") or stopped early. */
  stopReason: string | null;
}

export interface ConductorModel {
  /** A short label for logs, e.g. "claude-sonnet-5-5" or "scripted". */
  readonly name: string;
  /** True for the scripted stand-in used in sandbox rooms and tests. */
  readonly scripted: boolean;
  call(args: {
    system: string;
    user: string;
    /** JSON Schema the output must follow. */
    schema: Record<string, unknown>;
    maxTokens: number;
    /** Lets a scripted model see the structured input instead of parsing the prompt. */
    structuredInput?: unknown;
    purpose: 'conductor' | 'brief' | 'stand_in';
  }): Promise<ModelCallResult>;
}
