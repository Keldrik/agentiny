/**
 * Error class for agent-related errors.
 *
 * Provides structured error information with error codes and context for
 * debugging and programmatic error handling.
 */
export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: unknown,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}
