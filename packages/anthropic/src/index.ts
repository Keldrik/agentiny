/**
 * @agentiny/anthropic - Anthropic adapter for @agentiny/core
 *
 * Provides integration with Anthropic's Claude API.
 *
 * @example
 * ```typescript
 * import { createAnthropicAction } from '@agentiny/anthropic';
 * import { Agent } from '@agentiny/core';
 *
 * const agent = new Agent();
 * const llmAction = createAnthropicAction(
 *   { apiKey: process.env.ANTHROPIC_API_KEY! },
 *   {
 *     prompt: (state) => `Analyze: ${state.data}`,
 *     onResponse: (response, state) => { state.analysis = response; }
 *   }
 * );
 * ```
 */

export { createAnthropicAction } from './adapter';
export type { AnthropicConfig, AnthropicOptions } from './adapter';
