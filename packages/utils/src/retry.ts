import type { ActionFn } from '@agentiny/core';

/**
 * Retry options
 */
export interface RetryOptions {
  /**
   * Number of retry attempts
   */
  attempts: number;
  /**
   * Backoff strategy: 'linear' or 'exponential'
   * @default 'exponential'
   */
  backoff?: 'linear' | 'exponential';
  /**
   * Initial delay in milliseconds
   * @default 1000
   */
  delay?: number;
}

/**
 * Wraps an action with automatic retry logic
 *
 * @template TState - The type of the agent's state
 * @param action - Action to wrap
 * @param options - Retry options
 * @returns Wrapped action with retry capability
 *
 * @example
 * ```typescript
 * import { withRetry } from '@agentiny/utils';
 * import { Agent } from '@agentiny/core';
 *
 * const agent = new Agent();
 * const retryableAction = withRetry(
 *   async (state) => { await fetch('/api/data'); },
 *   { attempts: 3, backoff: 'exponential', delay: 1000 }
 * );
 *
 * agent.addTrigger({
 *   id: 'api-call',
 *   check: () => true,
 *   actions: [retryableAction]
 * });
 * ```
 */
export function withRetry<TState = unknown>(
  action: ActionFn<TState>,
  options: RetryOptions
): ActionFn<TState> {
  const { attempts, backoff = 'exponential', delay = 1000 } = options;

  return async (state: TState): Promise<void> => {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await Promise.resolve(action(state));
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < attempts - 1) {
          const waitTime =
            backoff === 'exponential' ? delay * Math.pow(2, attempt) : delay * (attempt + 1);

          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    throw lastError ?? new Error('Retry failed');
  };
}
