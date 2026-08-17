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
 * const analyzeAction = createOpenAIAction({
 *   prompt: (state) => `Analyze: ${state.data}`,
 *   onResponse: (result, state) => {
 *     state.analysis = result.text;
 *   },
 * });
 *
 * agent.addTrigger({
 *   id: 'analyze',
 *   check: (state) => !!state.data && !state.analysis,
 *   actions: [analyzeAction],
 * });
 * ```
 */

export { createOpenAIAction } from './adapter';
export type {
  ChatCompletionCreateRequest,
  ChatCompletionRequestOptions,
  OpenAIActionOptions,
  OpenAIActionResult,
  OpenAICompatibleClient,
  OpenAIMessage,
  OpenAIRole,
  OpenAIUsage,
} from './types';
