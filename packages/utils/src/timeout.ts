import type { ActionFn } from '@agentiny/core';

/**
 * Timeout options
 */
export interface TimeoutOptions {
  /**
   * Timeout duration in milliseconds
   */
  ms: number;
}

/**
 * Wraps an action with a timeout
 *
 * @template TState - The type of the agent's state
 * @param action - Action to wrap
 * @param options - Timeout options
 * @returns Wrapped action with timeout
 *
 * @throws {Error} If action exceeds timeout duration
 *
 * @example
 * ```typescript
 * import { withTimeout } from '@agentiny/utils';
 * import { Agent } from '@agentiny/core';
 *
 * const agent = new Agent();
 * const timeoutAction = withTimeout(
 *   async (state) => { await fetch('/api/data'); },
 *   { ms: 5000 }
 * );
 *
 * agent.addTrigger({
 *   id: 'timed-api-call',
 *   check: () => true,
 *   actions: [timeoutAction]
 * });
 * ```
 */
export function withTimeout<TState = unknown>(
  action: ActionFn<TState>,
  options: TimeoutOptions,
): ActionFn<TState> {
  const { ms } = options;

  return async (state: TState): Promise<void> => {
    return Promise.race([
      Promise.resolve(action(state)),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`Action timeout after ${ms}ms`)), ms),
      ),
    ]);
  };
}
