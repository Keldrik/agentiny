/**
 * @agentiny/gemini - Google Gemini adapter for @agentiny/core
 *
 * Provides integration with Google's Gemini API.
 *
 * @example
 * ```typescript
 * import { createGeminiAction } from '@agentiny/gemini';
 * import { Agent } from '@agentiny/core';
 *
 * const agent = new Agent();
 * const llmAction = createGeminiAction(
 *   { apiKey: process.env.GOOGLE_API_KEY! },
 *   (state) => `Analyze: ${state.data}`,
 *   (response, state) => { state.analysis = response; }
 * );
 * ```
 */

export { createGeminiAction } from './adapter';
export type { GeminiConfig, GeminiOptions } from './adapter';
