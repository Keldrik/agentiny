/**
 * @agentiny/openai - OpenAI adapter for @agentiny/core
 *
 * Provides integration with OpenAI's chat completion API.
 *
 * @example
 * ```typescript
 * import { createOpenAIAction } from '@agentiny/openai';
 * import { Agent } from '@agentiny/core';
 *
 * const agent = new Agent();
 * const llmAction = createOpenAIAction(
 *   { apiKey: process.env.OPENAI_API_KEY! },
 *   (state) => `Analyze: ${state.data}`,
 *   (response, state) => { state.analysis = response; }
 * );
 * ```
 */

export { createOpenAIAction } from './adapter';
export type { OpenAIConfig, OpenAIOptions } from './adapter';
