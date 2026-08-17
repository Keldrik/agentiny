import type { OpenAI } from 'openai';

export type OpenAIRole = 'system' | 'user' | 'assistant';

export interface OpenAIMessage {
  role: OpenAIRole;
  content: string;
}

export interface OpenAIUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface OpenAIActionResult<TParsed = string> {
  text: string;
  /**
   * Equals `text` when no schema is set. Parsed value when `schema` is set.
   */
  data: TParsed;
  usage?: OpenAIUsage;
  finishReason: string | null;
  model: string;
  raw: unknown;
}

export interface ChatCompletionCreateRequest {
  model: string;
  messages: OpenAIMessage[];
  max_completion_tokens?: number;
  temperature?: number;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  response_format?: unknown;
}

export interface ChatCompletionRequestOptions {
  signal?: AbortSignal;
}

export interface OpenAICompatibleClient {
  chat: {
    completions: {
      create: (
        body: ChatCompletionCreateRequest,
        options?: ChatCompletionRequestOptions,
      ) => Promise<unknown> | AsyncIterable<unknown>;
      parse?: (
        body: ChatCompletionCreateRequest,
        options?: ChatCompletionRequestOptions,
      ) => Promise<unknown>;
    };
  };
}

export interface OpenAIActionOptions<TState = unknown, TParsed = string> {
  /**
   * Existing OpenAI (or compatible) client. When set, `apiKey` and `baseURL` are ignored.
   */
  client?: OpenAI | OpenAICompatibleClient;
  /**
   * OpenAI API key. Optional when `client` is provided or `OPENAI_API_KEY` is set.
   */
  apiKey?: string;
  /**
   * Custom API endpoint. Optional when `client` is provided or `OPENAI_BASE_URL` is set.
   */
  baseURL?: string;
  /**
   * Model to use. Default: `gpt-5-nano`.
   */
  model?: string;
  /**
   * Build a single user message from state. Provide either `prompt` or `messages`.
   */
  prompt?: (state: TState) => string;
  /**
   * Build a message list from state. Provide either `prompt` or `messages`.
   */
  messages?: (state: TState) => OpenAIMessage[];
  /**
   * System prompt prepended to the message list.
   */
  system?: string | ((state: TState) => string);
  /**
   * Called once with the final result after the model returns.
   */
  onResponse: (result: OpenAIActionResult<TParsed>, state: TState) => void | Promise<void>;
  /**
   * Called with each text delta when streaming. Opts the request into `stream: true`.
   */
  onDelta?: (delta: string, state: TState) => void | Promise<void>;
  /**
   * JSON Schema object or a Zod-like object with `safeParse`.
   */
  schema?: unknown;
  /**
   * Name sent with JSON Schema structured output. Default: `response`.
   */
  schemaName?: string;
  /**
   * Maximum tokens to generate. Sent as `max_completion_tokens`.
   */
  maxTokens?: number;
  /**
   * Sampling temperature. Some GPT-5-class models reject this parameter.
   */
  temperature?: number;
}
