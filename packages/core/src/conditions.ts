import type { ConditionFn } from './types';

export interface ConditionResult {
  passed: boolean;
  errors: readonly Error[];
}

/**
 * Evaluates an array of condition functions against the provided state.
 *
 * This function sequentially evaluates all conditions, supporting both synchronous and
 * asynchronous condition functions. It short-circuits on the first failing condition,
 * meaning subsequent conditions are not evaluated if an earlier one returns false or
 * throws an error. If any condition throws an error, the function returns a failed
 * result with the collected error instead of propagating it.
 *
 * @template TState - The type of the state object
 * @param conditions - Array of condition functions to evaluate
 * @param state - The current state to pass to each condition function
 * @returns A promise that resolves to a ConditionResult with pass/fail status and errors
 *
 * @example
 * ```typescript
 * const conditions = [
 *   (state) => state.count > 0,
 *   (state) => state.count < 100,
 * ];
 * const result = await evaluateConditions(conditions, { count: 50 });
 * // result.passed === true
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
 * // result.passed === true when both conditions pass
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
  state: TState,
): Promise<ConditionResult> {
  if (conditions.length === 0) {
    return { passed: true, errors: [] };
  }

  for (const condition of conditions) {
    try {
      const result = await Promise.resolve(condition(state));

      if (!result) {
        return { passed: false, errors: [] };
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return { passed: false, errors: [err] };
    }
  }

  return { passed: true, errors: [] };
}
