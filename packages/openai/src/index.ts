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
 * const agent = new Agent({
 *   initialState: { data: '' }
 * });
 *
 * const analyzeAction = createOpenAIAction(
 *   { apiKey: process.env.OPENAI_API_KEY! },
 *   {
 *     prompt: (state) => `Analyze: ${state.data}`,
 *     onResponse: (response, state) => { state.analysis = response; }
 *   }
 * );
 *
 * agent.addTrigger({
 *   id: 'analyze',
 *   check: (state) => !!state.data && !state.analysis,
 *   actions: [analyzeAction]
 * });
 * ```
 */

export { createOpenAIAction } from './adapter';
export type { OpenAIConfig, OpenAIOptions } from './adapter';
