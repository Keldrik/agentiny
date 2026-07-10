/**
 * Function type for trigger checks
 *
 * @template TState - The type of the state object
 * @param state - Current state
 * @returns Boolean or promise resolving to boolean indicating if trigger should fire
 */
export type TriggerFn<TState = unknown> = (state: TState) => boolean | Promise<boolean>;

/**
 * Function type for condition checks
 *
 * @template TState - The type of the state object
 * @param state - Current state
 * @returns Boolean or promise resolving to boolean indicating if condition is met
 */
export type ConditionFn<TState = unknown> = (state: TState) => boolean | Promise<boolean>;

/**
 * Function type for `waitFor()` predicates
 *
 * Evaluated synchronously against the current state each time the state changes
 * (and on every execution-loop cycle while running). Must return a boolean.
 *
 * @template TState - The type of the state object
 * @param state - Current state
 * @returns True when the awaited condition is satisfied
 */
export type WaitForPredicate<TState = unknown> = (state: TState) => boolean;

/**
 * Context passed as the optional second argument to action functions.
 *
 * Actions may ignore this argument. Long-running actions should observe
 * `signal` and abort when the agent is stopped or paused.
 */
export interface ActionContext {
  /**
   * Aborted when the agent is stopped or paused.
   */
  signal: AbortSignal;
  /**
   * Id of the trigger that invoked this action.
   */
  triggerId: string;
}

/**
 * Function type for actions to execute
 *
 * @template TState - The type of the state object
 * @param state - Current state (may be mutated)
 * @param ctx - Optional execution context (signal, triggerId)
 * @returns Void or promise
 */
export type ActionFn<TState = unknown> = (
  state: TState,
  ctx?: ActionContext,
) => void | Promise<void>;

/**
 * Logger function type for error reporting
 *
 * @param error - The error to log
 */
export type LoggerFn = (error: unknown) => void;

/**
 * Configuration for creating an Agent
 *
 * @template TState - The type of the agent's state
 */
export interface AgentConfig<TState = unknown> {
  /**
   * Initial state of the agent
   */
  initialState?: TState;
  /**
   * Initial triggers to register
   */
  triggers?: Trigger<TState>[];
  /**
   * Error handler callback
   */
  onError?: (error: Error) => void;
  /**
   * Idle timeout in milliseconds between trigger checks when no settle() is pending.
   * Lower values = more responsive but higher CPU usage.
   * @default 100
   */
  idleTimeout?: number;
  /**
   * Max consecutive evaluation passes driven by state changes within one cascade.
   * When exceeded, the agent clears the dirty flag, reports via onError with code
   * `CASCADE_LIMIT_EXCEEDED`, and continues running.
   * @default 1000
   */
  maxCascadeDepth?: number;
  /**
   * Custom logger for state subscriber errors
   * @default console.error
   */
  logger?: LoggerFn;
}

/**
 * Trigger definition
 *
 * @template TState - The type of the agent's state
 */
export interface Trigger<TState = unknown> {
  /**
   * Unique identifier for this trigger
   */
  id: string;
  /**
   * Function to check if trigger should fire
   */
  check: TriggerFn<TState>;
  /**
   * Optional conditions that must all be true to execute actions
   */
  conditions?: readonly ConditionFn<TState>[];
  /**
   * Actions to execute when trigger fires and conditions pass
   */
  actions: readonly ActionFn<TState>[];
  /**
   * Whether this trigger should repeat or fire only once
   * @default true
   */
  repeat?: boolean;
  /**
   * Delay in milliseconds before executing actions.
   *
   * Delays are non-blocking: other triggers continue to evaluate while a
   * delayed trigger waits. Actions always receive a fresh state snapshot
   * taken immediately before execution (not the pre-delay state).
   * At most one delay may be pending per trigger at a time.
   */
  delay?: number;
  /**
   * Maximum number of times this trigger may fire before being automatically removed.
   * When both maxFires and repeat: false are set, the trigger is removed after the first fire.
   * @example maxFires: 3 — fires at most 3 times, then is auto-removed
   */
  maxFires?: number;
  /**
   * Evaluation priority. Higher values are evaluated first within each pass.
   * Triggers with equal priority retain their insertion order (stable sort).
   * @default 0
   */
  priority?: number;
}

/**
 * Agent status enumeration
 *
 * Represents the current state of an agent's execution:
 * - 'idle': Agent is initialized but not running
 * - 'running': Agent is actively monitoring triggers and executing actions
 * - 'paused': Agent execution is temporarily suspended; triggers are not evaluated
 * - 'stopped': Agent has been stopped and will not process triggers
 */
export enum AgentStatus {
  /**
   * Agent is initialized but not actively running
   */
  Idle = 'idle',
  /**
   * Agent is actively running and monitoring triggers
   */
  Running = 'running',
  /**
   * Agent execution is temporarily suspended
   */
  Paused = 'paused',
  /**
   * Agent has been stopped
   */
  Stopped = 'stopped',
}
