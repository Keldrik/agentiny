import type { Anthropic } from '@anthropic-ai/sdk';

export type AnthropicRole = 'user' | 'assistant';

export interface AnthropicMessage {
  role: AnthropicRole;
  content: string;
}

export interface AnthropicUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AnthropicActionResult<TParsed = string> {
  text: string;
  /**
   * Equals `text` when no schema is set. Parsed value when `schema` is set.
   */
  data: TParsed;
  usage?: AnthropicUsage;
  finishReason: string | null;
  model: string;
  raw: unknown;
}

export interface AnthropicMessageCreateRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  temperature?: number;
  stream?: boolean;
  output_config?: unknown;
}

export interface AnthropicRequestOptions {
  signal?: AbortSignal;
}

export interface AnthropicStreamLike {
  on?(event: 'text', listener: (delta: string, snapshot: string) => void): unknown;
  finalMessage?(): Promise<unknown>;
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
}

export interface AnthropicCompatibleClient {
  messages: {
    create: (
      body: AnthropicMessageCreateRequest,
      options?: AnthropicRequestOptions,
    ) => Promise<unknown> | AsyncIterable<unknown>;
    stream?: (
      body: AnthropicMessageCreateRequest,
      options?: AnthropicRequestOptions,
    ) => AnthropicStreamLike;
    parse?: (
      body: AnthropicMessageCreateRequest,
      options?: AnthropicRequestOptions,
    ) => Promise<unknown>;
  };
}

export interface AnthropicActionOptions<TState = unknown, TParsed = string> {
  /**
   * Existing Anthropic (or compatible) client. When set, `apiKey` and `baseURL` are ignored.
   */
  client?: Anthropic | AnthropicCompatibleClient;
  /**
   * Anthropic API key. Optional when `client` is provided or `ANTHROPIC_API_KEY` is set.
   */
  apiKey?: string;
  /**
   * Custom API endpoint. Optional when `client` is provided or `ANTHROPIC_BASE_URL` is set.
   */
  baseURL?: string;
  /**
   * Model to use. Default: `claude-haiku-4-5`.
   */
  model?: string;
  /**
   * Build a single user message from state. Provide either `prompt` or `messages`.
   */
  prompt?: (state: TState) => string;
  /**
   * Build a message list from state (`user` / `assistant` only). Provide either `prompt` or `messages`.
   */
  messages?: (state: TState) => AnthropicMessage[];
  /**
   * System prompt. Sent as the top-level Messages API `system` field, not as a message role.
   */
  system?: string | ((state: TState) => string);
  /**
   * Called once with the final result after the model returns.
   */
  onResponse: (result: AnthropicActionResult<TParsed>, state: TState) => void | Promise<void>;
  /**
   * Called with each text delta when streaming.
   */
  onDelta?: (delta: string, state: TState) => void | Promise<void>;
  /**
   * JSON Schema object or a Zod-like object with `safeParse`.
   */
  schema?: unknown;
  /**
   * Kept for adapter API parity. Anthropic's `output_config.format` has no name field.
   */
  schemaName?: string;
  /**
   * Maximum tokens to generate. Sent as required `max_tokens`. Default: 1024.
   */
  maxTokens?: number;
  /**
   * Sampling temperature (0–1).
   */
  temperature?: number;
}
