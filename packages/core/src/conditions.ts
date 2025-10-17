import type { ConditionFn } from './types';

/**
 * Evaluates an array of condition functions against the provided state.
 *
 * This function sequentially evaluates all conditions, supporting both synchronous and
 * asynchronous condition functions. It short-circuits on the first failing condition,
 * meaning subsequent conditions are not evaluated if an earlier one returns false or
 * throws an error. If any condition throws an error, the function returns false without
 * propagating the error.
 *
 * @template TState - The type of the state object
 * @param conditions - Array of condition functions to evaluate
 * @param state - The current state to pass to each condition function
 * @returns A promise that resolves to true if all conditions pass, false otherwise
 *
 * @example
 * ```typescript
 * const conditions = [
 *   (state) => state.count > 0,
 *   (state) => state.count < 100,
 * ];
 * const result = await evaluateConditions(conditions, { count: 50 });
 * // result === true
 * ```
 *
 * @example
 * ```typescript
 * // With async conditions
 * const conditions = [
 *   async (state) => {
 *     const isValid = await checkServer(state.id);
 *     return isValid;
 *   },
 *   (state) => state.status === 'active',
 * ];
 * const result = await evaluateConditions(conditions, state);
 * ```
 *
 * @example
 * ```typescript
 * // Short-circuiting behavior
 * const conditions = [
 *   (state) => false, // Returns false immediately
 *   async (state) => { // Never evaluated
 *     return true;
 *   },
 * ];
 * const result = await evaluateConditions(conditions, state);
 * // result === false (second condition not evaluated)
 * ```
 */
export async function evaluateConditions<TState>(
  conditions: readonly ConditionFn<TState>[],
  state: TState
): Promise<boolean> {
  // Empty conditions array returns true
  if (conditions.length === 0) {
    return true;
  }

  // Evaluate conditions sequentially with short-circuit
  for (const condition of conditions) {
    try {
      // Await the result to handle both sync and async conditions

      const result = await Promise.resolve(condition(state));

      // Short-circuit on first false
      if (!result) {
        return false;
      }
    } catch {
      // Return false on any error and stop evaluation
      return false;
    }
  }

  // All conditions passed
  return true;
}
