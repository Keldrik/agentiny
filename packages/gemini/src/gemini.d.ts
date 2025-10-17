/**
 * Type declarations for Google Generative AI SDK
 * These help TypeScript resolve the @google/generative-ai module during compilation
 */

declare module '@google/generative-ai' {
  export interface GenerationConfig {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  }

  export interface TextContent {
    type: 'text';
    text: string;
  }

  export interface ResponseContent {
    text(): string;
  }

  export interface GenerateContentResponse {
    response: ResponseContent;
    promptFeedback?: unknown;
  }

  export interface ModelConfig {
    model: string;
  }

  export interface GenerateContentRequest {
    generationConfig?: GenerationConfig;
    safetySettings?: unknown[];
    systemInstruction?: unknown;
  }

  export class GenerativeModel {
    constructor(modelConfig: ModelConfig);
    generateContent(
      request: string | unknown,
      requestOptions?: GenerateContentRequest,
    ): Promise<GenerateContentResponse>;
    countTokens(request: string | unknown): Promise<{ totalTokens: number }>;
  }

  export interface GoogleGenerativeAIOptions {
    apiKey: string;
    baseURL?: string;
  }

  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(modelConfig: ModelConfig): GenerativeModel;
  }
}
