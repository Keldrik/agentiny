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
 * Function type for actions to execute
 *
 * @template TState - The type of the state object
 * @param state - Current state (may be mutated)
 * @returns Void or promise
 */
export type ActionFn<TState = unknown> = (state: TState) => void | Promise<void>;

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
   * Delay in milliseconds before executing actions
   */
  delay?: number;
}

/**
 * Agent status enumeration
 *
 * Represents the current state of an agent's execution:
 * - 'idle': Agent is initialized but not running
 * - 'running': Agent is actively monitoring triggers and executing actions
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
   * Agent has been stopped
   */
  Stopped = 'stopped',
}
