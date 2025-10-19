import type { ActionFn } from '@agentiny/core';

/**
 * Validation error class
 *
 * Thrown when state validation fails
 */
export class ValidationError extends Error {
  /**
   * Create a new ValidationError instance
   *
   * @param message - Error message
   * @param errors - Validation errors
   */
  constructor(
    message: string,
    public readonly errors?: unknown[],
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validation options
 */
export interface ValidationOptions<T = unknown> {
  /**
   * Validation function
   */
  validate: (state: unknown) => state is T;
}

/**
 * Wraps an action with validation
 *
 * @template TState - The type of the agent's state
 * @param action - Action to wrap
 * @param options - Validation options
 * @returns Wrapped action with validation
 *
 * @throws {ValidationError} If validation fails
 *
 * @example
 * ```typescript
 * import { withValidation } from '@agentiny/utils';
 * import { Agent } from '@agentiny/core';
 *
 * interface ValidState {
 *   data: string;
 * }
 *
 * const agent = new Agent();
 * const validatedAction = withValidation(
 *   async (state) => { console.log(state.data); },
 *   {
 *     validate: (state): state is ValidState =>
 *       typeof state === 'object' &&
 *       state !== null &&
 *       'data' in state &&
 *       typeof (state as any).data === 'string'
 *   }
 * );
 *
 * agent.addTrigger({
 *   id: 'validated-action',
 *   check: () => true,
 *   actions: [validatedAction]
 * });
 * ```
 */
export function withValidation<TState = unknown>(
  action: ActionFn<TState>,
  options: ValidationOptions<TState>,
): ActionFn<unknown> {
  return async (state: unknown): Promise<void> => {
    if (!options.validate(state)) {
      throw new ValidationError('State validation failed');
    }
    await Promise.resolve(action(state));
  };
}

/**
 * Wraps an action with Zod schema validation
 *
 * @template TState - The type of the agent's state
 * @param action - Action to wrap
 * @param schema - Zod schema for validation
 * @returns Wrapped action with Zod validation
 *
 * @throws {ValidationError} If validation fails
 * @throws {Error} If Zod is not installed
 *
 * @example
 * ```typescript
 * import { withSchema } from '@agentiny/utils';
 * import { z } from 'zod';
 * import { Agent } from '@agentiny/core';
 *
 * const schema = z.object({
 *   data: z.string(),
 *   count: z.number().min(0)
 * });
 *
 * const agent = new Agent();
 * const validatedAction = withSchema(
 *   async (state) => { console.log(state.data); },
 *   schema
 * );
 *
 * agent.addTrigger({
 *   id: 'validated-action',
 *   check: () => true,
 *   actions: [validatedAction]
 * });
 * ```
 */

export function withSchema<TState = unknown>(
  action: ActionFn<TState>,
  schema: unknown,
): ActionFn<unknown> {
  return async (state: unknown): Promise<void> => {
    try {
      // Validate that schema is a Zod schema
      if (!schema || typeof schema !== 'object' || !('parse' in schema)) {
        throw new ValidationError('Invalid schema: expected a Zod schema');
      }

      // Validate the state using the schema
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (schema as any).safeParse(state);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(result as any).success) {
        throw new ValidationError(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          `State validation failed: ${JSON.stringify((result as any).error?.errors)}`,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (result as any).error?.errors,
        );
      }

      // Call the action with validated state
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await Promise.resolve(action((result as any).data));
    } catch (error) {
      // Re-throw validation errors as-is
      if (error instanceof ValidationError) {
        throw error;
      }

      // Wrap other errors
      if (error instanceof Error) {
        throw new ValidationError(`Validation error: ${error.message}`);
      }

      throw new ValidationError('Unknown validation error');
    }
  };
}
