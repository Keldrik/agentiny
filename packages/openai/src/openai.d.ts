/**
 * Type declarations for OpenAI SDK
 * These help TypeScript resolve the openai module during compilation
 */

declare module 'openai' {
  export interface ClientOptions {
    apiKey?: string;
    baseURL?: string;
    organization?: string;
    defaultHeaders?: Record<string, string>;
    defaultQuery?: Record<string, string | undefined>;
    timeout?: number;
    maxRetries?: number;
    httpClient?: unknown;
  }

  export interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
  }

  export interface ChatCompletionResponse {
    choices: Array<{
      message: {
        content: string;
        role: string;
      };
      finish_reason: string | null;
      index: number;
    }>;
  }

  export interface ChatCompletionCreateParams {
    model: string;
    messages: Message[];
    max_tokens?: number;
    temperature?: number;
  }

  export class OpenAI {
    constructor(options: ClientOptions);
    chat: {
      completions: {
        create(params: ChatCompletionCreateParams): Promise<ChatCompletionResponse>;
      };
    };
  }
}
