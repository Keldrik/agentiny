/**
 * @agentiny/anthropic - Anthropic adapter for @agentiny/core
 *
 * Provides integration with Anthropic's Claude Messages API.
 *
 * @example
 * ```typescript
 * import { createAnthropicAction } from '@agentiny/anthropic';
 * import { Agent } from '@agentiny/core';
 *
 * const agent = new Agent({
 *   initialState: { data: '' }
 * });
 *
 * const analyzeAction = createAnthropicAction({
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

export { createAnthropicAction } from './adapter';
export type {
  AnthropicActionOptions,
  AnthropicActionResult,
  AnthropicCompatibleClient,
  AnthropicMessage,
  AnthropicMessageCreateRequest,
  AnthropicRequestOptions,
  AnthropicRole,
  AnthropicStreamLike,
  AnthropicUsage,
} from './types';
