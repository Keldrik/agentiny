/**
 * @agentiny/core - Lightweight TypeScript agent framework
 *
 * Provides the core trigger-condition-action framework for building reactive agents.
 *
 * @example
 * ```typescript
 * import { Agent } from '@agentiny/core';
 *
 * const agent = new Agent({ initialState: { count: 0 } });
 * agent.addTrigger({
 *   id: 'count-watcher',
 *   check: (state) => state.count > 5,
 *   actions: [(state) => console.log('Count exceeded 5!')],
 * });
 * ```
 */

export type { TriggerFn, ConditionFn, ActionFn, AgentConfig, Trigger } from './types';
export { Agent, AgentError } from './agent';
export { State } from './state';
export { AgentStatus } from './types';
export { evaluateConditions } from './conditions';
export { executeActions } from './actions';
