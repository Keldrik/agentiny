import { State } from './state';
import { evaluateConditions } from './conditions';
import { executeActions } from './actions';
import type { AgentConfig, Trigger, AgentStatus, ActionFn, ConditionFn, TriggerFn } from './types';
import { AgentStatus as AgentStatusEnum } from './types';

/**
 * Error class for agent-related errors
 *
 * Provides structured error information with error codes and context
 * for debugging and error handling.
 */
export class AgentError extends Error {
  /**
   * Create a new AgentError instance
   *
   * @param message - Error message
   * @param code - Error code for programmatic error handling
   * @param context - Additional context information
   */
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: unknown,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

/**
 * Core agent implementation for trigger-condition-action flows
 *
 * @template TState - The type of the agent's state object
 *
 * @example
 * ```typescript
 * const agent = new Agent<{ count: number }>({
 *   initialState: { count: 0 }
 * });
 *
 * agent.addTrigger({
 *   id: 'count-watcher',
 *   check: (state) => state.count > 5,
 *   conditions: [(state) => state.count % 2 === 0],
 *   actions: [(state) => { state.count = 0; }],
 *   repeat: true
 * });
 *
 * await agent.start();
 * agent.setState({ count: 6 });
 * await agent.stop();
 * ```
 */
export class Agent<TState = unknown> {
  private _state: State<TState>;
  private _triggers: Map<string, Trigger<TState>>;
  private _status: AgentStatus;
  private _onError?: (error: Error) => void;
  private _executionLoop: Promise<void> | null = null;
  private _shouldRun = false;
  private _triggersExecuted: Set<string> = new Set();
  private _eventTriggers: Map<string, Set<string>> = new Map();
  private _emittedEvents: Set<string> = new Set();
  private _triggerIdCounter = 0;

  /**
   * Create a new Agent instance
   *
   * @param config - Configuration options
   */
  constructor(config: AgentConfig<TState> = {}) {
    const initialState = config.initialState as TState;
    this._state = new State<TState>(initialState);
    this._triggers = new Map();
    this._status = AgentStatusEnum.Idle;
    this._onError = config.onError;

    if (config.triggers) {
      config.triggers.forEach((trigger) => this.addTrigger(trigger));
    }
  }

  /**
   * Get the current state value
   *
   * @returns Current state
   */
  getState(): TState {
    return this._state.get();
  }

  /**
   * Set the agent's state and evaluate triggers
   *
   * @param newState - New state value
   */
  setState(newState: TState): void {
    this._state.set(newState);
  }

  /**
   * Subscribe to state changes
   *
   * @param callback - Function called with new state value
   * @returns Unsubscribe function
   */
  subscribe(callback: (state: TState) => void): () => void {
    return this._state.subscribe(callback);
  }

  /**
   * Get the current agent status
   *
   * @returns Current agent status (idle, running, or stopped)
   */
  getStatus(): AgentStatus {
    return this._status;
  }

  /**
   * Add a trigger to the agent
   *
   * Triggers must have unique IDs. Attempting to add a trigger with a duplicate
   * ID will throw an AgentError.
   *
   * @param trigger - Trigger configuration
   * @throws {AgentError} If a trigger with the same ID already exists
   *
   * @example
   * ```typescript
   * agent.addTrigger({
   *   id: 'counter-trigger',
   *   check: (state) => state.count > 10,
   *   actions: [(state) => { state.count = 0; }]
   * });
   * ```
   */
  addTrigger(trigger: Trigger<TState>): void {
    if (this._triggers.has(trigger.id)) {
      throw new AgentError(`Trigger with id "${trigger.id}" already exists`, 'DUPLICATE_TRIGGER', {
        triggerId: trigger.id,
      });
    }
    this._triggers.set(trigger.id, trigger);
  }

  /**
   * Get a trigger by ID
   *
   * @param id - Trigger ID
   * @returns The trigger with the given ID, or undefined if not found
   */
  getTrigger(id: string): Trigger<TState> | undefined {
    return this._triggers.get(id);
  }

  /**
   * Get all triggers registered with this agent
   *
   * @returns Array of all registered triggers
   */
  getAllTriggers(): Trigger<TState>[] {
    return Array.from(this._triggers.values());
  }

  /**
   * Remove a trigger by ID
   *
   * @param id - Trigger ID
   * @throws {AgentError} If no trigger with the given ID exists
   *
   * @example
   * ```typescript
   * agent.removeTrigger('counter-trigger');
   * ```
   */
  removeTrigger(id: string): void {
    if (!this._triggers.has(id)) {
      throw new AgentError(`Trigger with id "${id}" not found`, 'TRIGGER_NOT_FOUND', {
        triggerId: id,
      });
    }
    this._triggers.delete(id);
  }

  /**
   * Clear all triggers from the agent
   *
   * @example
   * ```typescript
   * agent.clearTriggers();
   * ```
   */
  clearTriggers(): void {
    this._triggers.clear();
  }

  /**
   * Start the agent (evaluates triggers)
   *
   * Transitions the agent from idle to running status. If the agent is already
   * running, throws an AgentError. Starts the internal execution loop that continuously
   * checks triggers and executes them when conditions are met.
   *
   * @throws {AgentError} If agent is already running
   *
   * @example
   * ```typescript
   * await agent.start();
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async start(): Promise<void> {
    try {
      if (this._status === AgentStatusEnum.Running) {
        throw new AgentError('Agent is already running', 'AGENT_ALREADY_RUNNING', {
          currentStatus: this._status,
        });
      }

      this._status = AgentStatusEnum.Running;
      this._shouldRun = true;
      this._triggersExecuted.clear();

      // Start the execution loop (fire and forget)
      this._executionLoop = this._runExecutionLoop();
    } catch (error) {
      if (this._onError && error instanceof AgentError) {
        this._onError(error);
      }
      throw error;
    }
  }

  /**
   * Stop the agent
   *
   * Transitions the agent from running to stopped status. If the agent is not
   * currently running, throws an AgentError. Stops the internal execution loop and
   * waits for any ongoing trigger execution to complete.
   *
   * @throws {AgentError} If agent is not running
   *
   * @example
   * ```typescript
   * await agent.stop();
   * ```
   */
  async stop(): Promise<void> {
    try {
      if (this._status !== AgentStatusEnum.Running) {
        throw new AgentError('Agent is not running', 'AGENT_NOT_RUNNING', {
          currentStatus: this._status,
        });
      }

      this._status = AgentStatusEnum.Stopped;
      this._shouldRun = false;

      // Wait for the execution loop to finish
      if (this._executionLoop) {
        await this._executionLoop;
        this._executionLoop = null;
      }
    } catch (error) {
      if (this._onError && error instanceof AgentError) {
        this._onError(error);
      }
      throw error;
    }
  }

  /**
   * Check if agent is running
   *
   * @returns True if agent is running
   */
  isRunning(): boolean {
    return this._status === AgentStatusEnum.Running;
  }

  /**
   * Internal execution loop that continuously checks and executes triggers.
   *
   * This method runs while the agent is running (_shouldRun is true). It:
   * 1. Iterates through all registered triggers
   * 2. Checks if each trigger's condition is met
   * 3. Evaluates conditions if the trigger check passes
   * 4. Executes actions if all conditions pass
   * 5. Handles repeating vs one-time triggers
   * 6. Applies delays before action execution
   * 7. Collects and reports any errors
   *
   * @returns Promise that resolves when the loop exits
   */
  private async _runExecutionLoop(): Promise<void> {
    const pollInterval = 10; // milliseconds between trigger checks

    while (this._shouldRun) {
      try {
        const triggers = this.getAllTriggers();

        for (const trigger of triggers) {
          if (!this._shouldRun) {
            break; // Stop checking triggers if agent is stopping
          }

          await this._checkAndExecuteTrigger(trigger);
        }

        // Small delay to prevent busy-waiting

        await new Promise((resolve) => {
          setTimeout(resolve, pollInterval);
        });
      } catch (error) {
        // Log error but continue the loop
        if (error instanceof Error && this._onError) {
          this._onError(error);
        }
      }
    }
  }

  /**
   * Checks if a trigger should fire and executes it if appropriate.
   *
   * This method:
   * 1. Evaluates the trigger's check function
   * 2. If check passes, evaluates all conditions
   * 3. If conditions pass, applies delay if configured
   * 4. Executes all actions
   * 5. For one-time triggers (repeat: false), removes them after execution
   * 6. Calls onError callback if any errors occur during execution
   *
   * @param trigger - The trigger to check and execute
   */
  private async _checkAndExecuteTrigger(trigger: Trigger<TState>): Promise<void> {
    try {
      const state = this._state.get();

      // Check if trigger condition is met
      const checkResult = await Promise.resolve(trigger.check(state));

      if (!checkResult) {
        return; // Trigger check failed, nothing to do
      }

      // Evaluate conditions (if any)
      const conditions = trigger.conditions ?? [];
      const conditionsPass = await evaluateConditions(conditions, state);

      if (!conditionsPass) {
        return; // Conditions failed, don't execute actions
      }

      // Handle delay before execution
      if (trigger.delay && trigger.delay > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, trigger.delay);
        });
      }

      // Execute all actions
      const errors = await executeActions(trigger.actions, state);

      // Report any errors from action execution
      if (errors.length > 0 && this._onError) {
        for (const error of errors) {
          this._onError(error);
        }
      }

      // Handle one-time triggers (repeat: false)
      if (trigger.repeat === false) {
        // Remove the trigger after execution
        this.removeTrigger(trigger.id);
      }
    } catch (error) {
      // Catch any unexpected errors and report them
      if (this._onError) {
        if (error instanceof Error) {
          this._onError(error);
        } else {
          this._onError(new Error(String(error)));
        }
      }
    }
  }

  /**
   * Generate a unique trigger ID
   *
   * @returns A unique trigger ID
   */
  private _generateTriggerId(): string {
    return `__trigger_${++this._triggerIdCounter}`;
  }

  /**
   * Emit an event that triggers all event-based listeners
   *
   * @param event - The event name to emit
   *
   * @example
   * ```typescript
   * agent.emitEvent('user-login');
   * ```
   */
  emitEvent(event: string): void {
    this._emittedEvents.add(event);
  }

  /**
   * Create an event-based trigger with convenience syntax
   *
   * This creates a trigger that fires when a specific event is emitted via emitEvent().
   * Supports optional conditions that must all pass before executing actions.
   *
   * @template TState - The type of the agent's state
   * @param event - The event name to listen for
   * @param actionsOrConditions - Either actions array or conditions array
   * @param actionsOrRepeat - Either actions array (if previous param is conditions) or repeat flag
   * @param repeatOptional - Optional repeat flag if using overload with conditions
   * @returns The generated trigger ID
   *
   * @example
   * ```typescript
   * // Simple: just actions
   * agent.on('login', [logUserIn]);
   *
   * // With conditions
   * agent.on('save', [checkPermission], [saveData], true);
   * ```
   */
  on(
    event: string,
    actionsOrConditions: readonly ActionFn<TState>[] | readonly ConditionFn<TState>[],
    actionsOrRepeat?: readonly ActionFn<TState>[] | boolean,
    repeatOptional?: boolean,
  ): string {
    const triggerId = this._generateTriggerId();

    // Determine overload: on(event, actions) or on(event, conditions, actions, repeat?)
    let conditions: readonly ConditionFn<TState>[] | undefined;
    let actions: readonly ActionFn<TState>[];
    let repeat = true;

    if (actionsOrRepeat === undefined || typeof actionsOrRepeat === 'boolean') {
      // Overload: on(event, actions, repeat?)

      actions = actionsOrConditions as readonly ActionFn<TState>[];
      repeat = typeof actionsOrRepeat === 'boolean' ? actionsOrRepeat : true;
    } else {
      // Overload: on(event, conditions, actions, repeat?)

      conditions = actionsOrConditions as readonly ConditionFn<TState>[];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      actions = actionsOrRepeat as readonly ActionFn<TState>[];
      repeat = repeatOptional ?? true;
    }

    // Register trigger with event-based check
    const trigger: Trigger<TState> = {
      id: triggerId,
      check: (): boolean => {
        const hasEvent = this._emittedEvents.has(event);
        if (hasEvent) {
          this._emittedEvents.delete(event);
        }
        return hasEvent;
      },
      conditions,
      actions,
      repeat,
    };

    this.addTrigger(trigger);

    // Track the relationship between event and trigger
    if (!this._eventTriggers.has(event)) {
      this._eventTriggers.set(event, new Set());
    }
    this._eventTriggers.get(event)?.add(triggerId);

    return triggerId;
  }

  /**
   * Create a state-based repeating trigger with convenience syntax
   *
   * This creates a trigger that repeatedly fires when the check function returns true,
   * with optional conditions that must all pass before executing actions.
   *
   * @template TState - The type of the agent's state
   * @param check - Function that checks if trigger should fire
   * @param actionsOrConditions - Either actions array or conditions array
   * @param actionsOptional - Optional actions array if using conditions
   * @returns The generated trigger ID
   *
   * @example
   * ```typescript
   * // Simple: just check and actions
   * agent.when(
   *   (state) => state.count > 10,
   *   [resetCount]
   * );
   *
   * // With conditions
   * agent.when(
   *   (state) => state.count > 10,
   *   [checkPermission],
   *   [resetCount]
   * );
   * ```
   */
  when(
    check: TriggerFn<TState>,
    actionsOrConditions: readonly ActionFn<TState>[] | readonly ConditionFn<TState>[],
    actionsOptional?: readonly ActionFn<TState>[],
  ): string {
    const triggerId = this._generateTriggerId();

    // Determine overload: when(check, actions) or when(check, conditions, actions)
    let conditions: readonly ConditionFn<TState>[] | undefined;
    let actions: readonly ActionFn<TState>[];

    if (actionsOptional === undefined) {
      // Overload: when(check, actions)
      actions = actionsOrConditions as readonly ActionFn<TState>[];
    } else {
      // Overload: when(check, conditions, actions)
      conditions = actionsOrConditions as readonly ConditionFn<TState>[];
      actions = actionsOptional;
    }

    const trigger: Trigger<TState> = {
      id: triggerId,
      check,
      conditions,
      actions,
      repeat: true,
    };

    this.addTrigger(trigger);
    return triggerId;
  }

  /**
   * Create a one-time trigger with convenience syntax
   *
   * This creates a trigger that fires only once when the check function returns true,
   * with optional conditions that must all pass before executing actions.
   * The trigger is automatically removed after execution.
   *
   * @template TState - The type of the agent's state
   * @param check - Function that checks if trigger should fire
   * @param actionsOrConditions - Either actions array or conditions array
   * @param actionsOptional - Optional actions array if using conditions
   * @returns The generated trigger ID
   *
   * @example
   * ```typescript
   * // Simple: just check and actions
   * agent.once(
   *   (state) => state.initialized === true,
   *   [startApp]
   * );
   *
   * // With conditions
   * agent.once(
   *   (state) => state.initialized === true,
   *   [checkSecurity],
   *   [startApp]
   * );
   * ```
   */
  once(
    check: TriggerFn<TState>,
    actionsOrConditions: readonly ActionFn<TState>[] | readonly ConditionFn<TState>[],
    actionsOptional?: readonly ActionFn<TState>[],
  ): string {
    const triggerId = this._generateTriggerId();

    // Determine overload: once(check, actions) or once(check, conditions, actions)
    let conditions: readonly ConditionFn<TState>[] | undefined;
    let actions: readonly ActionFn<TState>[];

    if (actionsOptional === undefined) {
      // Overload: once(check, actions)
      actions = actionsOrConditions as readonly ActionFn<TState>[];
    } else {
      // Overload: once(check, conditions, actions)
      conditions = actionsOrConditions as readonly ConditionFn<TState>[];
      actions = actionsOptional;
    }

    const trigger: Trigger<TState> = {
      id: triggerId,
      check,
      conditions,
      actions,
      repeat: false,
    };

    this.addTrigger(trigger);
    return triggerId;
  }
}
