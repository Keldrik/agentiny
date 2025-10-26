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
 * Internal interface for tracking pending settle() promises
 */
interface SettleResolver {
  quietCycles: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
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
  private _stateChanged = true;
  private _eventEmissionCount = new Map<string, number>();
  private _eventLastSeenByTrigger = new Map<string, Map<string, number>>();
  private _eventTriggers = new Map<string, Set<string>>();
  private _triggerIdCounter = 0;
  private _consecutiveQuietCycles = 0;
  private _settleResolvers: SettleResolver[] = [];

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

    // Subscribe to state changes to trigger re-evaluation of triggers
    this._state.subscribe(() => {
      this._stateChanged = true;
    });

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

    // Clean up from event tracking maps
    this._eventLastSeenByTrigger.forEach((triggerMap) => {
      triggerMap.delete(id);
    });
    for (const [event, triggerIds] of this._eventTriggers.entries()) {
      triggerIds.delete(id);
      // Clean up empty entries
      if (triggerIds.size === 0) {
        this._eventTriggers.delete(event);
      }
    }
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

  async start(): Promise<void> {
    try {
      if (this._status === AgentStatusEnum.Running) {
        throw new AgentError('Agent is already running', 'AGENT_ALREADY_RUNNING', {
          currentStatus: this._status,
        });
      }

      this._status = AgentStatusEnum.Running;
      this._shouldRun = true;
      this._stateChanged = true; // Evaluate triggers immediately on start
      this._consecutiveQuietCycles = 0; // Reset quiet cycle counter
      this._eventEmissionCount.clear();
      this._eventLastSeenByTrigger.clear();
      this._eventTriggers.clear();

      // Start the execution loop (fire and forget)
      this._executionLoop = this._runExecutionLoop();
    } catch (error) {
      if (this._onError && error instanceof Error) {
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

      // Reject all pending settle promises
      const settleError = new AgentError('Agent stopped while waiting to settle', 'AGENT_STOPPED', {
        pendingSettles: this._settleResolvers.length,
      });

      for (const resolver of this._settleResolvers) {
        if (resolver.timeoutId) {
          clearTimeout(resolver.timeoutId);
        }
        resolver.reject(settleError);
      }
      this._settleResolvers = [];

      // Wait for the execution loop to finish
      if (this._executionLoop) {
        await this._executionLoop;
        this._executionLoop = null;
      }
    } catch (error) {
      if (this._onError && error instanceof Error) {
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
   * Wait for all pending actions and cascading triggers to complete
   *
   * Returns a promise that resolves when the agent has been quiet for the specified
   * number of consecutive polling cycles. This is useful for waiting until all cascading
   * trigger-action flows have settled before continuing.
   *
   * The function uses a "consecutive quiet cycles" model: after each polling cycle where
   * no state changes occurred, the quiet cycle counter increments. Once it reaches the
   * requested number, all cascading effects are complete.
   *
   * @param quietCycles - Number of consecutive quiet cycles to wait for (default: 2, ~20ms)
   * @param timeout - Maximum time to wait in milliseconds (default: 10000, 10 seconds)
   * @returns Promise that resolves when settle conditions are met
   * @throws {AgentError} If agent is not running
   * @throws {Error} If timeout is exceeded before settling
   *
   * @example
   * ```typescript
   * agent.setState({ document: readFile() });
   * await agent.settle(); // Wait for all cascading actions
   * console.log('All actions complete!');
   * ```
   */
  settle(quietCycles = 2, timeout = 10000): Promise<void> {
    if (!this.isRunning()) {
      throw new AgentError('Agent must be running to settle', 'AGENT_NOT_RUNNING', {
        currentStatus: this._status,
      });
    }

    if (quietCycles <= 0) {
      throw new AgentError('quietCycles must be a positive integer', 'INVALID_ARGUMENT', {
        quietCycles,
      });
    }

    // If already quiet enough, resolve immediately
    if (this._consecutiveQuietCycles >= quietCycles) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const resolver: SettleResolver = {
        quietCycles,
        resolve,
        reject,
      };

      resolver.timeoutId = setTimeout(() => {
        // Remove from resolvers
        this._settleResolvers = this._settleResolvers.filter((r) => r !== resolver);
        reject(
          new AgentError(
            `settle() timed out after ${timeout}ms waiting for ${quietCycles} quiet cycles`,
            'SETTLE_TIMEOUT',
            { timeout, quietCycles, currentQuietCycles: this._consecutiveQuietCycles },
          ),
        );
      }, timeout);

      this._settleResolvers.push(resolver);
    });
  }

  /**
   * Internal method to check and resolve settle promises
   *
   * Called each quiet cycle to check if any pending settle promises can be resolved.
   */
  private _checkSettleResolvers(): void {
    // Filter out resolved promises
    this._settleResolvers = this._settleResolvers.filter((resolver) => {
      if (this._consecutiveQuietCycles >= resolver.quietCycles) {
        // This resolver can be satisfied
        if (resolver.timeoutId) {
          clearTimeout(resolver.timeoutId);
        }
        resolver.resolve();
        return false; // Remove from array
      }
      return true; // Keep in array
    });
  }

  /**
   * Internal execution loop that continuously checks and executes triggers.
   *
   * This method runs while the agent is running (_shouldRun is true). It:
   * 1. Checks if state has changed since the last evaluation (optimization)
   * 2. If state changed, iterates through all registered triggers
   * 3. Checks if each trigger's condition is met
   * 4. Evaluates conditions if the trigger check passes
   * 5. Executes actions if all conditions pass
   * 6. Handles repeating vs one-time triggers
   * 7. Applies delays before action execution
   * 8. Collects and reports any errors
   *
   * Performance Optimization:
   * - Only evaluates triggers when state changes, not on every poll cycle
   * - Reduces CPU usage for agents with many triggers (100+)
   * - Uses a subscription to the internal state to track changes
   * - Maintains a 10ms polling interval as a fallback for edge cases
   *
   * @returns Promise that resolves when the loop exits
   */
  private async _runExecutionLoop(): Promise<void> {
    const pollInterval = 10; // milliseconds between trigger checks

    while (this._shouldRun) {
      try {
        // Track if state changed at the start of this cycle
        const stateChangedThisCycle = this._stateChanged;

        // Only evaluate triggers if state has changed (optimization for many triggers)
        if (this._stateChanged) {
          this._stateChanged = false;
          const triggers = this.getAllTriggers();

          for (const trigger of triggers) {
            if (!this._shouldRun) {
              break; // Stop checking triggers if agent is stopping
            }

            await this._checkAndExecuteTrigger(trigger);
          }
        }

        // Track quiet cycles for settle() functionality
        if (stateChangedThisCycle) {
          // State changed, so we did an evaluation. Reset quiet counter.
          this._consecutiveQuietCycles = 0;
        } else {
          // State didn't change, so no evaluation happened. Increment quiet counter.
          this._consecutiveQuietCycles++;
          this._checkSettleResolvers();
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
        // Remove the trigger after execution (check exists in case of concurrent modifications)
        if (this._triggers.has(trigger.id)) {
          this.removeTrigger(trigger.id);
        }
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
   * When an event is emitted, all registered event-based triggers for that event
   * will fire once on the next polling cycle (within 10ms). Multiple triggers
   * listening to the same event will all see the same emission.
   *
   * @param event - The event name to emit
   *
   * @example
   * ```typescript
   * agent.emitEvent('user-login');
   * ```
   */
  emitEvent(event: string): void {
    const currentCount = this._eventEmissionCount.get(event) ?? 0;
    this._eventEmissionCount.set(event, currentCount + 1);
    // Signal that triggers should be evaluated for this event emission
    this._stateChanged = true;
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

      actions = actionsOrRepeat as readonly ActionFn<TState>[];
      repeat = repeatOptional ?? true;
    }

    // Register trigger with event-based check
    const trigger: Trigger<TState> = {
      id: triggerId,
      check: (): boolean => {
        const currentEmissionCount = this._eventEmissionCount.get(event) ?? 0;

        // Get the last emission count this trigger saw for this event
        let triggerEventMap = this._eventLastSeenByTrigger.get(event);
        if (!triggerEventMap) {
          triggerEventMap = new Map();
          this._eventLastSeenByTrigger.set(event, triggerEventMap);
        }
        const lastSeenCount = triggerEventMap.get(triggerId) ?? 0;

        // Check if there's a new emission
        if (currentEmissionCount > lastSeenCount) {
          // Update the last seen count for this trigger
          triggerEventMap.set(triggerId, currentEmissionCount);
          return true;
        }
        return false;
      },
      conditions,
      actions,
      repeat,
    };

    this.addTrigger(trigger);

    // Track this trigger as an event-based trigger for the given event
    if (!this._eventTriggers.has(event)) {
      this._eventTriggers.set(event, new Set());
    }
    this._eventTriggers.get(event)?.add(triggerId);

    return triggerId;
  }

  /**
   * Remove a specific event-based trigger
   *
   * Removes a trigger that was created via the `on()` method. This is a convenience
   * method that removes a trigger by event name and trigger ID, without needing to
   * call `removeTrigger()` directly.
   *
   * @param event - The event name the trigger was listening to
   * @param triggerId - The trigger ID returned from `on()`
   * @throws {AgentError} If no trigger with the given ID exists
   *
   * @example
   * ```typescript
   * const id = agent.on('save', [saveAction]);
   * // Later:
   * agent.removeEventTrigger('save', id);
   * ```
   */
  removeEventTrigger(_event: string, triggerId: string): void {
    // event parameter kept for API clarity, even though it's not used internally
    this.removeTrigger(triggerId);
  }

  /**
   * Remove all event-based triggers for a specific event
   *
   * Removes all triggers that were created via the `on()` method for a given event name.
   * This is useful for cleaning up multiple listeners at once.
   *
   * @param event - The event name to remove all triggers for
   *
   * @example
   * ```typescript
   * agent.on('save', [action1]);
   * agent.on('save', [action2]);
   * agent.on('save', [action3]);
   * // Later, remove all listeners for 'save':
   * agent.removeAllEventTriggersForEvent('save');
   * ```
   */
  removeAllEventTriggersForEvent(event: string): void {
    const triggerIds = this._eventTriggers.get(event);
    if (triggerIds) {
      // Create a copy of the set since removeTrigger will modify it
      const triggerIdsCopy = Array.from(triggerIds);
      for (const triggerId of triggerIdsCopy) {
        this.removeTrigger(triggerId);
      }
    }
  }

  /**
   * Get all event-based triggers for a specific event
   *
   * Returns the actual Trigger objects for all event-based triggers listening to a given event.
   * This is useful for inspecting which triggers are registered for an event and their configuration.
   *
   * @param event - The event name to query
   * @returns Array of Trigger objects for the given event
   *
   * @example
   * ```typescript
   * agent.on('login', [action1]);
   * agent.on('login', [action2]);
   * const triggers = agent.getEventTriggersForEvent('login');
   * // triggers.length === 2
   * // Can inspect trigger.repeat, trigger.delay, etc.
   * ```
   */
  getEventTriggersForEvent(event: string): Trigger<TState>[] {
    const triggerIds = this._eventTriggers.get(event);
    if (!triggerIds) {
      return [];
    }
    const triggers: Trigger<TState>[] = [];
    for (const triggerId of triggerIds) {
      const trigger = this._triggers.get(triggerId);
      if (trigger) {
        triggers.push(trigger);
      }
    }
    return triggers;
  }

  /**
   * Get all event-based triggers organized by event name
   *
   * Returns a map where keys are event names and values are arrays of Trigger objects.
   * This is useful for getting a complete overview of all event-based triggers in the agent.
   *
   * @returns Map of event names to arrays of Trigger objects
   *
   * @example
   * ```typescript
   * agent.on('login', [action1]);
   * agent.on('login', [action2]);
   * agent.on('logout', [action3]);
   * const allEventTriggers = agent.getEventTriggers();
   * // allEventTriggers.get('login').length === 2
   * // allEventTriggers.get('logout').length === 1
   * ```
   */
  getEventTriggers(): Map<string, Trigger<TState>[]> {
    const result = new Map<string, Trigger<TState>[]>();

    for (const [event, triggerIds] of this._eventTriggers.entries()) {
      const triggers: Trigger<TState>[] = [];
      for (const triggerId of triggerIds) {
        const trigger = this._triggers.get(triggerId);
        if (trigger) {
          triggers.push(trigger);
        }
      }
      if (triggers.length > 0) {
        result.set(event, triggers);
      }
    }

    return result;
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
