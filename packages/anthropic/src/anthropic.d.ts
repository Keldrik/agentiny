/**
 * Type declarations for Anthropic SDK
 * These help TypeScript resolve the @anthropic-ai/sdk module during compilation
 */

declare module '@anthropic-ai/sdk' {
  export interface ClientOptions {
    apiKey?: string;
    baseURL?: string;
    defaultHeaders?: Record<string, string>;
    defaultQuery?: Record<string, string | undefined>;
    timeout?: number;
    maxRetries?: number;
  }

  export interface Message {
    role: 'user' | 'assistant';
    content: string;
  }

  export interface TextBlock {
    type: 'text';
    text: string;
  }

  export interface MessageResponse {
    content: TextBlock[];
    id: string;
    model: string;
    stop_reason: string;
    stop_sequence: string | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  }

  export interface MessageCreateParams {
    model: string;
    messages: Message[];
    max_tokens: number;
    temperature?: number;
    system?: string;
  }

  export class Anthropic {
    constructor(options: ClientOptions);
    messages: {
      create(params: MessageCreateParams): Promise<MessageResponse>;
    };
  }
}
