import type { ActionFn } from './types';

/**
 * Executes an array of action functions against the provided state.
 *
 * This function sequentially executes all actions, supporting both synchronous and
 * asynchronous action functions. Critically, actions continue executing even if
 * one throws an error - errors are collected and returned rather than interrupting
 * execution. This ensures partial execution of action sequences is possible and
 * errors are reported together at the end.
 *
 * @template TState - The type of the state object
 * @param actions - Array of action functions to execute
 * @param state - The state object to pass to each action (may be mutated)
 * @returns A promise that resolves to an array of errors encountered (empty if none)
 *
 * @example
 * ```typescript
 * const actions = [
 *   (state) => { state.count++; },
 *   async (state) => { await updateServer(state); },
 *   (state) => { state.modified = true; },
 * ];
 * const errors = await executeActions(actions, state);
 * if (errors.length > 0) {
 *   console.error('Some actions failed:', errors);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Errors are collected, not thrown
 * const actions = [
 *   () => { throw new Error('Error 1'); },
 *   () => { console.log('This still runs'); },
 *   () => { throw new Error('Error 2'); },
 * ];
 * const errors = await executeActions(actions, state);
 * // errors.length === 2, both errors collected
 * // All 3 actions executed despite errors
 * ```
 *
 * @example
 * ```typescript
 * // State mutations persist through all actions
 * const state = { count: 0 };
 * const actions = [
 *   (s) => { s.count += 1; },
 *   async (s) => { await delay(100); s.count += 2; },
 *   (s) => { s.count *= 3; },
 * ];
 * await executeActions(actions, state);
 * // state.count === 9 ((0 + 1 + 2) * 3)
 * ```
 */
export async function executeActions<TState>(
  actions: readonly ActionFn<TState>[],
  state: TState,
): Promise<Error[]> {
  const errors: Error[] = [];

  // Execute each action sequentially
  for (const action of actions) {
    try {
      // Use Promise.resolve() to uniformly handle both sync and async actions

      await Promise.resolve(action(state));
    } catch (error) {
      // Collect the error but continue executing remaining actions
      if (error instanceof Error) {
        errors.push(error);
      } else {
        // Wrap non-Error objects in an Error
        errors.push(new Error(String(error)));
      }
    }
  }

  return errors;
}
