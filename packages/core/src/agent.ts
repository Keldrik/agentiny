import { State } from './state';
import { evaluateConditions } from './conditions';
import { executeActions } from './actions';
import { AgentError } from './errors';
import type {
  AgentConfig,
  Trigger,
  AgentStatus,
  ActionFn,
  ConditionFn,
  TriggerFn,
  WaitForPredicate,
} from './types';
import { AgentStatus as AgentStatusEnum } from './types';
import type { AtOptions, EveryOptions, IntervalSpec } from './schedule';
import { msUntil, nextOccurrence, parseInterval, parseTimeOfDay } from './schedule';

export { AgentError };

/**
 * Internal interface for tracking pending settle() promises
 */
interface SettleResolver {
  quietCycles: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface DelayWaiter {
  timer: ReturnType<typeof setTimeout>;
  resolve: (completed: boolean) => void;
}

/**
 * Internal interface for tracking pending waitFor() promises
 */
interface WaitForResolver<TState> {
  predicate: WaitForPredicate<TState>;
  resolve: (state: TState) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface ScheduleController {
  start: () => void;
  stop: (clearReady: boolean) => void;
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
  private _eventTriggerConsumers = new Map<string, () => void>();
  private _triggerIdCounter = 0;
  private _consecutiveQuietCycles = 0;
  private _settleResolvers: SettleResolver[] = [];
  private _waitForResolvers: WaitForResolver<TState>[] = [];
  private _wakeResolve: (() => void) | null = null;
  private _idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private _idleTimeout: number;
  private _initialState: TState | undefined;
  private _disabledTriggers: Set<string> = new Set<string>();
  private _triggerFireCount: Map<string, number> = new Map<string, number>();
  private _sortedTriggersCache: Trigger<TState>[] | null = null;
  private _scheduleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _scheduleControllers = new Map<string, ScheduleController>();
  private _delayWaiters = new Map<string, Set<DelayWaiter>>();

  /**
   * Create a new Agent instance
   *
   * @param config - Configuration options
   */
  constructor(config: AgentConfig<TState> = {}) {
    const initialState = config.initialState as TState;
    this._state = new State<TState>(initialState, config.logger);
    this._triggers = new Map();
    this._status = AgentStatusEnum.Idle;
    this._onError = config.onError;
    if (
      config.idleTimeout !== undefined &&
      (!Number.isFinite(config.idleTimeout) || config.idleTimeout <= 0)
    ) {
      throw new AgentError('idleTimeout must be a positive finite number', 'INVALID_ARGUMENT', {
        idleTimeout: config.idleTimeout,
      });
    }
    this._idleTimeout = config.idleTimeout ?? 100;
    this._initialState = config.initialState;

    // Subscribe to state changes to trigger re-evaluation of triggers
    this._state.subscribe(() => {
      this._stateChanged = true;
      // Resolve any waitFor() predicates immediately on setState/updateState so
      // they settle with zero latency and work even while idle or paused.
      this._checkWaitForResolvers();
      this._wake();
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
   * Merge a partial update into the current state.
   *
   * Convenience wrapper for object state types. Equivalent to calling
   * `setState({ ...getState(), ...partial })`. Only meaningful when TState is a
   * plain object type — for primitive or array state, use setState() directly.
   *
   * @param partial - Partial state to merge into current state
   */
  updateState(partial: Partial<TState>): void {
    this.setState({ ...this.getState(), ...partial });
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
   * @returns The trigger ID (useful for removing the trigger later)
   * @throws {AgentError} If a trigger with the same ID already exists
   *
   * @example
   * ```typescript
   * const triggerId = agent.addTrigger({
   *   id: 'counter-trigger',
   *   check: (state) => state.count > 10,
   *   actions: [(state) => { state.count = 0; }]
   * });
   *
   * // Later: remove the trigger
   * agent.removeTrigger(triggerId);
   * ```
   */
  addTrigger(trigger: Trigger<TState>): string {
    // Validate id first — the duplicate check below keys on it.
    if (typeof trigger.id !== 'string' || trigger.id.length === 0) {
      throw new AgentError('Trigger id must be a non-empty string', 'INVALID_ARGUMENT', {
        triggerId: trigger.id,
      });
    }
    if (this._triggers.has(trigger.id)) {
      throw new AgentError(`Trigger with id "${trigger.id}" already exists`, 'DUPLICATE_TRIGGER', {
        triggerId: trigger.id,
      });
    }
    if (typeof trigger.check !== 'function') {
      throw new AgentError('Trigger check must be a function', 'INVALID_ARGUMENT', {
        triggerId: trigger.id,
      });
    }
    if (!Array.isArray(trigger.actions) || trigger.actions.some((a) => typeof a !== 'function')) {
      throw new AgentError('Trigger actions must be an array of functions', 'INVALID_ARGUMENT', {
        triggerId: trigger.id,
      });
    }
    if (
      trigger.conditions !== undefined &&
      (!Array.isArray(trigger.conditions) ||
        trigger.conditions.some((c) => typeof c !== 'function'))
    ) {
      throw new AgentError('Trigger conditions must be an array of functions', 'INVALID_ARGUMENT', {
        triggerId: trigger.id,
      });
    }
    if (trigger.delay !== undefined && (!Number.isFinite(trigger.delay) || trigger.delay < 0)) {
      throw new AgentError('delay must be a non-negative finite number', 'INVALID_ARGUMENT', {
        triggerId: trigger.id,
        delay: trigger.delay,
      });
    }
    if (trigger.priority !== undefined && !Number.isFinite(trigger.priority)) {
      throw new AgentError('priority must be a finite number', 'INVALID_ARGUMENT', {
        triggerId: trigger.id,
        priority: trigger.priority,
      });
    }
    if (
      trigger.maxFires !== undefined &&
      (!Number.isInteger(trigger.maxFires) || trigger.maxFires <= 0)
    ) {
      throw new AgentError('maxFires must be a positive integer', 'INVALID_ARGUMENT', {
        triggerId: trigger.id,
        maxFires: trigger.maxFires,
      });
    }
    this._triggers.set(trigger.id, trigger);
    this._invalidateSortedTriggers();
    if (this.isRunning()) {
      this._stateChanged = true;
      this._wake();
    }
    return trigger.id;
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
    this._disabledTriggers.delete(id);
    this._triggerFireCount.delete(id);
    this._invalidateSortedTriggers();

    this._stopScheduledTrigger(id, true);
    this._scheduleControllers.delete(id);
    this._cancelDelayWaiters(id);

    // Clean up from event tracking maps
    this._eventLastSeenByTrigger.forEach((triggerMap) => {
      triggerMap.delete(id);
    });
    for (const [event, triggerIds] of this._eventTriggers.entries()) {
      triggerIds.delete(id);
      // When the last listener for an event is gone, drop the event's
      // bookkeeping entirely so unique event names cannot accumulate.
      if (triggerIds.size === 0) {
        this._eventTriggers.delete(event);
        this._eventEmissionCount.delete(event);
        this._eventLastSeenByTrigger.delete(event);
      }
    }
    this._eventTriggerConsumers.delete(id);
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
    this._stopAllScheduledTriggers(true);
    this._scheduleControllers.clear();
    this._cancelAllDelayWaiters();
    this._triggers.clear();
    this._eventTriggers.clear();
    this._eventEmissionCount.clear();
    this._eventLastSeenByTrigger.clear();
    this._eventTriggerConsumers.clear();
    this._disabledTriggers.clear();
    this._triggerFireCount.clear();
    this._invalidateSortedTriggers();
  }

  /**
   * Temporarily disable a trigger without removing it.
   *
   * Disabled triggers are skipped during evaluation but remain registered.
   * Re-enable with enableTrigger().
   *
   * @param id - Trigger ID
   * @throws {AgentError} If no trigger with the given ID exists
   *
   * @example
   * ```typescript
   * agent.disableTrigger('my-trigger');
   * // Later:
   * agent.enableTrigger('my-trigger');
   * ```
   */
  disableTrigger(id: string): void {
    if (!this._triggers.has(id)) {
      throw new AgentError(`Trigger with id "${id}" not found`, 'TRIGGER_NOT_FOUND', {
        triggerId: id,
      });
    }
    this._disabledTriggers.add(id);
  }

  /**
   * Re-enable a previously disabled trigger.
   *
   * @param id - Trigger ID
   * @throws {AgentError} If no trigger with the given ID exists
   */
  enableTrigger(id: string): void {
    if (!this._triggers.has(id)) {
      throw new AgentError(`Trigger with id "${id}" not found`, 'TRIGGER_NOT_FOUND', {
        triggerId: id,
      });
    }
    this._disabledTriggers.delete(id);
    if (this.isRunning()) {
      this._stateChanged = true;
      this._wake();
    }
  }

  /**
   * Check if a trigger is currently disabled.
   *
   * @param id - Trigger ID
   * @returns True if the trigger exists and is disabled
   */
  isTriggerDisabled(id: string): boolean {
    return this._disabledTriggers.has(id);
  }

  /**
   * Restore state to the value passed as initialState in the constructor.
   *
   * Works whether the agent is running, paused, or stopped. If clearTriggersOnReset
   * is true, all registered triggers are also removed.
   *
   * **Limitation:** The initialState reference is stored as-is, not deep cloned.
   * If the initial state object was mutated after construction (e.g., via direct
   * action mutation), reset() will restore to that mutated object. Use a factory
   * pattern or construct a new Agent for true immutable resets.
   *
   * @param clearTriggersOnReset - If true, also clears all triggers (default: false)
   * @throws {AgentError} If no initialState was provided to the constructor
   */
  reset(clearTriggersOnReset = false): void {
    if (this._initialState === undefined) {
      throw new AgentError(
        'Cannot reset: no initialState was provided to the constructor',
        'AGENT_NOT_INITIALIZED',
        { currentStatus: this._status },
      );
    }
    this.setState(this._initialState);
    if (clearTriggersOnReset) {
      this.clearTriggers();
    }
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
      if (this._status === AgentStatusEnum.Paused) {
        throw new AgentError('Agent is paused; call resume() instead', 'AGENT_PAUSED', {
          currentStatus: this._status,
        });
      }

      this._status = AgentStatusEnum.Running;
      this._shouldRun = true;
      this._stateChanged = true; // Evaluate triggers immediately on start
      this._consecutiveQuietCycles = 0; // Reset quiet cycle counter
      this._eventEmissionCount.clear();
      this._eventLastSeenByTrigger.clear();
      this._startScheduledTriggers();

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
      if (this._status !== AgentStatusEnum.Running && this._status !== AgentStatusEnum.Paused) {
        throw new AgentError('Agent is not running', 'AGENT_NOT_RUNNING', {
          currentStatus: this._status,
        });
      }

      this._status = AgentStatusEnum.Stopped;
      this._shouldRun = false;

      // Cancel any pending scheduled timers so they don't fire post-stop
      this._stopAllScheduledTriggers(true);
      this._cancelAllDelayWaiters();

      // Wake the execution loop so it can exit immediately
      this._wake();

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

      // Reject all pending waitFor promises so awaiters don't hang
      const waitStopError = new AgentError(
        'Agent stopped while waiting for predicate',
        'AGENT_STOPPED',
        { pendingWaiters: this._waitForResolvers.length },
      );
      for (const resolver of this._waitForResolvers) {
        if (resolver.timeoutId) {
          clearTimeout(resolver.timeoutId);
        }
        resolver.reject(waitStopError);
      }
      this._waitForResolvers = [];

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
   * Check if agent is paused
   *
   * @returns True if agent is paused
   */
  isPaused(): boolean {
    return this._status === AgentStatusEnum.Paused;
  }

  /**
   * Pause the agent, temporarily suspending trigger evaluation.
   *
   * The agent stops evaluating triggers but retains all registered triggers,
   * current state, and pending settle() promises. Pending settle() timeouts
   * continue to tick while paused. Resume with resume().
   *
   * @throws {AgentError} If agent is not running
   * @throws {AgentError} If agent is already paused
   *
   * @example
   * ```typescript
   * await agent.pause();
   * // ... triggers are not evaluated ...
   * await agent.resume();
   * ```
   */
  async pause(): Promise<void> {
    try {
      if (this._status === AgentStatusEnum.Paused) {
        throw new AgentError('Agent is already paused', 'AGENT_ALREADY_PAUSED', {
          currentStatus: this._status,
        });
      }
      if (this._status !== AgentStatusEnum.Running) {
        throw new AgentError('Agent is not running', 'AGENT_NOT_RUNNING', {
          currentStatus: this._status,
        });
      }

      this._status = AgentStatusEnum.Paused;
      this._shouldRun = false;
      this._cancelAllDelayWaiters();

      // Wake the loop so it exits its current wait immediately
      this._wake();

      // Wait for the execution loop to finish its current cycle and exit
      if (this._executionLoop) {
        await this._executionLoop;
        this._executionLoop = null;
      }
      // NOTE: _settleResolvers are intentionally NOT rejected here.
      // Their timeouts keep ticking. They will be resolved/rejected when
      // resume() restarts the loop and quiet cycles are detected.
    } catch (error) {
      if (this._onError && error instanceof Error) {
        this._onError(error);
      }
      throw error;
    }
  }

  /**
   * Resume a paused agent, restarting trigger evaluation.
   *
   * Triggers are immediately re-evaluated on resume. Does not reset the
   * trigger ID counter or event emission counts.
   *
   * @throws {AgentError} If agent is not paused
   *
   * @example
   * ```typescript
   * await agent.pause();
   * await agent.resume();
   * ```
   */
  async resume(): Promise<void> {
    try {
      if (this._status !== AgentStatusEnum.Paused) {
        throw new AgentError('Agent is not paused', 'AGENT_NOT_PAUSED', {
          currentStatus: this._status,
        });
      }

      this._status = AgentStatusEnum.Running;
      this._shouldRun = true;
      this._stateChanged = true; // Re-evaluate triggers immediately on resume

      // Restart the execution loop
      this._executionLoop = this._runExecutionLoop();

      // Wake any pending settle() waiters
      this._wake();
    } catch (error) {
      if (this._onError && error instanceof Error) {
        this._onError(error);
      }
      throw error;
    }
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

    if (!Number.isInteger(quietCycles) || quietCycles <= 0) {
      throw new AgentError('quietCycles must be a positive integer', 'INVALID_ARGUMENT', {
        quietCycles,
      });
    }

    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new AgentError('timeout must be a positive finite number', 'INVALID_ARGUMENT', {
        timeout,
      });
    }

    // If already quiet enough AND no pending state changes, resolve immediately
    if (!this._stateChanged && this._consecutiveQuietCycles >= quietCycles) {
      return Promise.resolve();
    }

    // Wake the loop to switch from idle timeout to faster settle polling
    this._wake();

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
   * Wait until the agent's state first satisfies a predicate.
   *
   * Returns a promise that resolves with the matching state the moment the
   * predicate returns true. Unlike settle() (which waits for the whole system
   * to go quiet), waitFor() waits for one specific condition.
   *
   * Predicates are evaluated synchronously: immediately when called, on every
   * setState()/updateState() change (zero latency, even while idle or paused),
   * and on every execution-loop cycle while running (so in-place action
   * mutations are observed too). The resolved value is the live state reference,
   * consistent with getState() — it is not deep cloned and may continue to
   * mutate after resolution.
   *
   * Callable in any status. Note that without a running agent only
   * setState()/updateState() changes can satisfy the predicate; trigger- and
   * timer-driven changes require start(). A predicate that throws rejects the
   * returned promise.
   *
   * @param predicate - Synchronous function tested against the current state
   * @param timeout - Maximum time to wait in milliseconds (default: 10000)
   * @returns Promise resolving with the state that satisfied the predicate
   * @throws {AgentError} Synchronously if predicate is not a function or timeout
   *   is not a positive finite number
   * @throws {AgentError} (rejection) with code `WAITFOR_TIMEOUT` if the
   *   predicate is not satisfied in time, or `AGENT_STOPPED` if the agent is
   *   stopped while waiting
   *
   * @example
   * ```typescript
   * await agent.start();
   * const ready = await agent.waitFor((state) => state.ready);
   * ```
   */
  waitFor(predicate: WaitForPredicate<TState>, timeout = 10000): Promise<TState> {
    if (typeof predicate !== 'function') {
      throw new AgentError('predicate must be a function', 'INVALID_ARGUMENT', {});
    }
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new AgentError('timeout must be a positive finite number', 'INVALID_ARGUMENT', {
        timeout,
      });
    }

    // Immediate synchronous check: resolve/reject now if already satisfied.
    const state = this._state.get();
    try {
      if (predicate(state) === true) {
        return Promise.resolve(state);
      }
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    return new Promise<TState>((resolve, reject) => {
      const resolver: WaitForResolver<TState> = { predicate, resolve, reject };

      resolver.timeoutId = setTimeout(() => {
        const idx = this._waitForResolvers.indexOf(resolver);
        if (idx !== -1) {
          this._waitForResolvers.splice(idx, 1);
        }
        reject(
          new AgentError(`waitFor() timed out after ${timeout}ms`, 'WAITFOR_TIMEOUT', { timeout }),
        );
      }, timeout);

      this._waitForResolvers.push(resolver);
      // Wake the loop so it switches to the faster poll interval (and observes
      // in-place mutations) while this waiter is pending.
      this._wake();
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
   * Internal method to check and resolve waitFor promises.
   *
   * Evaluates each pending predicate against the current state. Resolves
   * matching waiters and rejects waiters whose predicate throws.
   *
   * Reentrancy- and mutation-safe: predicates run user code that may call
   * setState()/stop()/waitFor() and re-enter this method. We snapshot the
   * resolver list, re-read state per iteration, skip resolvers already removed
   * by a reentrant call or timeout, and remove each resolver from the live
   * array before settling it. A throwing predicate is caught per-resolver and
   * never rethrown (which would otherwise spin the execution loop).
   */
  private _checkWaitForResolvers(): void {
    if (this._waitForResolvers.length === 0) {
      return;
    }
    const pending = this._waitForResolvers.slice();
    for (const resolver of pending) {
      // Skip if a reentrant call or the timeout already settled this resolver.
      if (this._waitForResolvers.indexOf(resolver) === -1) {
        continue;
      }
      const state = this._state.get();
      let matched = false;
      let thrown: Error | undefined;
      try {
        matched = resolver.predicate(state) === true;
      } catch (error) {
        thrown = error instanceof Error ? error : new Error(String(error));
      }
      if (!matched && !thrown) {
        continue;
      }
      // Remove from the live array before settling so reentrant calls don't
      // observe a settled resolver.
      const idx = this._waitForResolvers.indexOf(resolver);
      if (idx !== -1) {
        this._waitForResolvers.splice(idx, 1);
      }
      if (resolver.timeoutId) {
        clearTimeout(resolver.timeoutId);
      }
      if (thrown) {
        resolver.reject(thrown);
      } else {
        resolver.resolve(state);
      }
    }
  }

  /**
   * Wake the execution loop to process pending changes immediately.
   *
   * Called when state changes or events are emitted to trigger immediate
   * evaluation instead of waiting for the next timeout.
   */
  private _wake(): void {
    if (this._idleTimeoutId !== null) {
      clearTimeout(this._idleTimeoutId);
      this._idleTimeoutId = null;
    }
    if (this._wakeResolve) {
      const resolve = this._wakeResolve;
      this._wakeResolve = null;
      resolve();
    }
  }

  /**
   * Wait for the next evaluation cycle.
   *
   * Returns immediately if there are pending changes. Otherwise waits for
   * either a wake signal (from setState/emitEvent) or a timeout.
   *
   * Uses a short 10ms timeout when settle() or waitFor() is pending — for
   * settle() to maintain quiet cycle tracking, and for waitFor() to notice
   * in-place state mutations promptly. Uses the configurable idleTimeout
   * otherwise to save CPU.
   */
  private _waitForNextCycle(): Promise<void> {
    // If already have pending changes, don't wait
    if (this._stateChanged) {
      return Promise.resolve();
    }

    const pollInterval = 10; // milliseconds for settle() quiet cycle tracking
    const hasSettleWaiters = this._settleResolvers.length > 0;
    const hasWaitForWaiters = this._waitForResolvers.length > 0;

    // Create wake promise
    const wakePromise = new Promise<void>((resolve) => {
      this._wakeResolve = resolve;
    });

    // Determine timeout based on whether settle()/waitFor() is waiting.
    // Short timeout (10ms) when settle needs quiet cycle tracking or waitFor
    // needs to observe in-place mutations; configurable idle timeout otherwise.
    const timeout = hasSettleWaiters || hasWaitForWaiters ? pollInterval : this._idleTimeout;

    const timeoutPromise = new Promise<void>((resolve) => {
      this._idleTimeoutId = setTimeout(() => {
        this._idleTimeoutId = null;
        resolve();
      }, timeout);
    });

    return Promise.race([wakePromise, timeoutPromise]);
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
   * - Uses event-driven wake mechanism for immediate response to state changes
   * - Only evaluates triggers when state changes, not on every cycle
   * - Uses configurable idleTimeout when no settle() is pending
   * - Maintains 10ms polling when settle() is waiting for quiet cycles
   *
   * @returns Promise that resolves when the loop exits
   */
  private async _runExecutionLoop(): Promise<void> {
    while (this._shouldRun) {
      try {
        // Track if state changed at the start of this cycle
        const stateChangedThisCycle = this._stateChanged;

        // Only evaluate triggers if state has changed (optimization for many triggers)
        if (this._stateChanged) {
          this._stateChanged = false;
          const triggers = this._getSortedTriggers();

          for (const trigger of triggers) {
            if (!this._shouldRun) {
              break; // Stop checking triggers if agent is stopping
            }

            await this._checkAndExecuteTrigger(trigger);
          }
        }

        // Resolve waitFor() predicates every cycle so in-place action mutations
        // (which never go through State.set) are observed while running.
        this._checkWaitForResolvers();

        // Track quiet cycles for settle() functionality
        if (stateChangedThisCycle) {
          // State changed, so we did an evaluation. Reset quiet counter.
          this._consecutiveQuietCycles = 0;
        } else {
          // State didn't change, so no evaluation happened. Increment quiet counter.
          this._consecutiveQuietCycles++;
          this._checkSettleResolvers();
        }

        if (!this._shouldRun) {
          break;
        }

        // Wait for next event or timeout (event-driven instead of fixed polling)
        await this._waitForNextCycle();
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
      if (!this._triggers.has(trigger.id)) {
        return;
      }

      // Skip disabled triggers without removing them
      if (this._disabledTriggers.has(trigger.id)) {
        return;
      }

      const state = this._state.get();

      // Check if trigger condition is met
      const checkResult = await Promise.resolve(trigger.check(state));

      if (!checkResult) {
        return; // Trigger check failed, nothing to do
      }

      // Evaluate conditions (if any)
      const conditions = trigger.conditions ?? [];
      const conditionResult = await evaluateConditions(conditions, state);

      // Report any errors from condition evaluation
      if (conditionResult.errors.length > 0 && this._onError) {
        for (const error of conditionResult.errors) {
          this._onError(error);
        }
      }

      if (!conditionResult.passed) {
        return; // Conditions failed, don't execute actions
      }

      if (!this._shouldRun || !this._triggers.has(trigger.id)) {
        return;
      }

      // Consume any pending event emission for this trigger now that we have
      // committed to firing. Until this point a failing condition would have
      // left the emission pending for a future cycle.
      this._eventTriggerConsumers.get(trigger.id)?.();

      // Handle delay before execution
      if (trigger.delay && trigger.delay > 0) {
        const completed = await this._waitForDelay(trigger.id, trigger.delay);
        if (!completed) {
          return;
        }
      }

      if (
        !this._shouldRun ||
        !this._triggers.has(trigger.id) ||
        this._disabledTriggers.has(trigger.id)
      ) {
        return;
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

      // Handle maxFires limit — skip if repeat: false already removed the trigger
      if (trigger.maxFires !== undefined && this._triggers.has(trigger.id)) {
        const count = (this._triggerFireCount.get(trigger.id) ?? 0) + 1;
        this._triggerFireCount.set(trigger.id, count);
        if (count >= trigger.maxFires) {
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
   * Invalidate cached priority ordering after trigger collection changes.
   */
  private _invalidateSortedTriggers(): void {
    this._sortedTriggersCache = null;
  }

  /**
   * Get triggers ordered by priority, preserving insertion order for ties.
   */
  private _getSortedTriggers(): Trigger<TState>[] {
    if (!this._sortedTriggersCache) {
      this._sortedTriggersCache = this.getAllTriggers().sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
      );
    }
    return this._sortedTriggersCache;
  }

  /**
   * Generate a unique trigger ID
   *
   * @returns A unique trigger ID
   */
  private _generateTriggerId(): string {
    return `__trigger_${++this._triggerIdCounter}`;
  }

  private _startScheduledTriggers(): void {
    for (const controller of this._scheduleControllers.values()) {
      controller.start();
    }
  }

  private _stopScheduledTrigger(id: string, clearReady: boolean): void {
    const controller = this._scheduleControllers.get(id);
    if (controller) {
      controller.stop(clearReady);
      return;
    }
    const timer = this._scheduleTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this._scheduleTimers.delete(id);
    }
  }

  private _stopAllScheduledTriggers(clearReady: boolean): void {
    for (const controller of this._scheduleControllers.values()) {
      controller.stop(clearReady);
    }
    this._scheduleTimers.clear();
  }

  private _waitForDelay(triggerId: string, delay: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const waiter: DelayWaiter = {
        timer: setTimeout(() => {
          this._removeDelayWaiter(triggerId, waiter);
          resolve(true);
        }, delay),
        resolve,
      };

      let waiters = this._delayWaiters.get(triggerId);
      if (!waiters) {
        waiters = new Set();
        this._delayWaiters.set(triggerId, waiters);
      }
      waiters.add(waiter);
    });
  }

  private _removeDelayWaiter(triggerId: string, waiter: DelayWaiter): void {
    const waiters = this._delayWaiters.get(triggerId);
    if (!waiters) {
      return;
    }
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this._delayWaiters.delete(triggerId);
    }
  }

  private _cancelDelayWaiters(triggerId: string): void {
    const waiters = this._delayWaiters.get(triggerId);
    if (!waiters) {
      return;
    }
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(false);
    }
    this._delayWaiters.delete(triggerId);
  }

  private _cancelAllDelayWaiters(): void {
    for (const triggerId of Array.from(this._delayWaiters.keys())) {
      this._cancelDelayWaiters(triggerId);
    }
  }

  /**
   * Emit an event that triggers all event-based listeners
   *
   * Event emissions are coalesced wake signals, not a queue. Multiple
   * `emitEvent('foo')` calls before the loop processes them fire each
   * matching trigger **once**, not once per call. If you need per-message
   * delivery, encode the count in state via `setState`.
   *
   * If a trigger's conditions fail on the cycle that processes the emission,
   * the emission remains pending for that trigger; it will be re-evaluated
   * on subsequent wake-ups and fire when the conditions are satisfied (or
   * be dropped if the trigger is removed first).
   *
   * If no trigger is currently listening for the event, the call is a no-op.
   *
   * @param event - The event name to emit
   *
   * @example
   * ```typescript
   * agent.emitEvent('user-login');
   * ```
   */
  emitEvent(event: string): void {
    // If no trigger is currently listening to this event there is nothing to
    // evaluate; skip both the counter bump (which would otherwise accumulate
    // entries for dynamically-named events) and the wake.
    const listeners = this._eventTriggers.get(event);
    if (!listeners || listeners.size === 0) {
      return;
    }
    const currentCount = this._eventEmissionCount.get(event) ?? 0;
    this._eventEmissionCount.set(event, currentCount + 1);
    // Signal that triggers should be evaluated for this event emission
    this._stateChanged = true;
    this._wake();
  }

  /**
   * Create an event-based trigger with convenience syntax
   *
   * This creates a trigger that fires when a specific event is emitted via emitEvent().
   * Supports optional conditions that must all pass before executing actions.
   *
   * Delivery semantics: emissions are coalesced wake signals. Several
   * `emitEvent(event)` calls between two cycles fire this trigger at most
   * once. A pending emission is consumed only after `conditions` pass, so a
   * failing condition leaves the emission armed for a later cycle.
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

    // Event triggers use coalesced wake-signal semantics: the trigger fires
    // once per cycle in which at least one new emission is pending. The
    // emission is only "consumed" (lastSeen advanced) after conditions pass,
    // so a failing condition leaves the emission pending until conditions are
    // satisfied on a later cycle or the trigger is removed.
    const getTriggerEventMap = (): Map<string, number> => {
      let triggerEventMap = this._eventLastSeenByTrigger.get(event);
      if (!triggerEventMap) {
        triggerEventMap = new Map();
        this._eventLastSeenByTrigger.set(event, triggerEventMap);
      }
      return triggerEventMap;
    };

    const trigger: Trigger<TState> = {
      id: triggerId,
      check: (): boolean => {
        const currentEmissionCount = this._eventEmissionCount.get(event) ?? 0;
        const lastSeenCount = this._eventLastSeenByTrigger.get(event)?.get(triggerId) ?? 0;
        return currentEmissionCount > lastSeenCount;
      },
      conditions,
      actions,
      repeat,
    };

    this._eventTriggerConsumers.set(triggerId, () => {
      const currentEmissionCount = this._eventEmissionCount.get(event) ?? 0;
      getTriggerEventMap().set(triggerId, currentEmissionCount);
    });

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
   * @throws {AgentError} If `triggerId` is not registered for `event`
   *
   * @example
   * ```typescript
   * const id = agent.on('save', [saveAction]);
   * // Later:
   * agent.removeEventTrigger('save', id);
   * ```
   */
  removeEventTrigger(event: string, triggerId: string): void {
    const listeners = this._eventTriggers.get(event);
    if (!listeners || !listeners.has(triggerId)) {
      throw new AgentError(
        `Trigger "${triggerId}" is not registered for event "${event}"`,
        'TRIGGER_NOT_FOUND',
        { event, triggerId },
      );
    }
    this.removeTrigger(triggerId);
  }

  /**
   * Remove a trigger by ID. Shorthand for removeTrigger().
   *
   * Consistent with DOM/EventEmitter convention for a concise off() call.
   *
   * @param triggerId - Trigger ID to remove
   * @throws {AgentError} If no trigger with the given ID exists
   *
   * @example
   * ```typescript
   * const id = agent.when((state) => state.count > 0, [action]);
   * // Later:
   * agent.off(id);
   * ```
   */
  off(triggerId: string): void {
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

  /**
   * Create a time-of-day trigger that fires at a specific wall-clock time.
   *
   * Time is interpreted in the host's local timezone. Accepts `"HH:MM"`
   * (24-hour) or `"H:MMam"` / `"H:MMpm"` (12-hour, case-insensitive). By
   * default repeats daily at the same wall-clock time; pass `{ once: true }`
   * to fire only on the next occurrence and self-remove.
   *
   * @param time - Time-of-day string
   * @param actionsOrConditions - Either actions array or conditions array
   * @param actionsOrOptions - Actions array (when previous arg is conditions) or options
   * @param optionsOptional - Options when using the conditions overload
   * @returns The generated trigger ID
   *
   * @example
   * ```typescript
   * agent.at('21:30', [sendDailyReport]);
   * agent.at('9:30am', [isWeekday], [sendStandupReminder]);
   * agent.at('00:00', [resetCounters], { once: true });
   * ```
   */
  at(
    time: string,
    actionsOrConditions: readonly ActionFn<TState>[] | readonly ConditionFn<TState>[],
    actionsOrOptions?: readonly ActionFn<TState>[] | AtOptions,
    optionsOptional?: AtOptions,
  ): string {
    const timeOfDay = parseTimeOfDay(time);

    let conditions: readonly ConditionFn<TState>[] | undefined;
    let actions: readonly ActionFn<TState>[];
    let options: AtOptions | undefined;

    if (Array.isArray(actionsOrOptions)) {
      // Overload: at(time, conditions, actions, options?)
      conditions = actionsOrConditions as readonly ConditionFn<TState>[];
      actions = actionsOrOptions as readonly ActionFn<TState>[];
      options = optionsOptional;
    } else {
      // Overload: at(time, actions, options?)
      actions = actionsOrConditions as readonly ActionFn<TState>[];
      options = actionsOrOptions as AtOptions | undefined;
    }

    const once = options?.once === true;
    const triggerId = this._generateTriggerId();
    let ready = false;

    const check: TriggerFn<TState> = (): boolean => {
      if (ready) {
        ready = false;
        return true;
      }
      return false;
    };

    const stop = (clearReady: boolean): void => {
      const timer = this._scheduleTimers.get(triggerId);
      if (timer) {
        clearTimeout(timer);
        this._scheduleTimers.delete(triggerId);
      }
      if (clearReady) {
        ready = false;
      }
    };

    const scheduleNext = (): void => {
      if (!this._triggers.has(triggerId)) {
        return;
      }
      if (this._scheduleTimers.has(triggerId)) {
        return;
      }
      const ms = msUntil(nextOccurrence(timeOfDay));
      const timer = setTimeout(() => {
        this._scheduleTimers.delete(triggerId);
        if (!this._triggers.has(triggerId)) {
          return;
        }
        ready = true;
        this._stateChanged = true;
        this._wake();
        if (!once) {
          scheduleNext();
        }
      }, ms);
      this._scheduleTimers.set(triggerId, timer);
    };

    this.addTrigger({
      id: triggerId,
      check,
      conditions,
      actions,
      repeat: !once,
      priority: options?.priority,
      maxFires: options?.maxFires,
    });
    this._scheduleControllers.set(triggerId, { start: scheduleNext, stop });
    if (this.isRunning() || this.isPaused()) {
      scheduleNext();
    }
    return triggerId;
  }

  /**
   * Create an interval-based trigger that fires every `interval`.
   *
   * Accepts a positive number of milliseconds, or a string of the form
   * `<number><unit>` where unit is `ms`, `s`, `m`, or `h`.
   *
   * @param interval - Interval as milliseconds or duration string
   * @param actionsOrConditions - Either actions array or conditions array
   * @param actionsOrOptions - Actions array (when previous arg is conditions) or options
   * @param optionsOptional - Options when using the conditions overload
   * @returns The generated trigger ID
   *
   * @example
   * ```typescript
   * agent.every('2h', [refreshFeed]);
   * agent.every(30_000, [hasPendingWork], [flushQueue]);
   * agent.every('5s', [poll], { immediate: true });
   * ```
   */
  every(
    interval: IntervalSpec,
    actionsOrConditions: readonly ActionFn<TState>[] | readonly ConditionFn<TState>[],
    actionsOrOptions?: readonly ActionFn<TState>[] | EveryOptions,
    optionsOptional?: EveryOptions,
  ): string {
    const intervalMs = parseInterval(interval);

    let conditions: readonly ConditionFn<TState>[] | undefined;
    let actions: readonly ActionFn<TState>[];
    let options: EveryOptions | undefined;

    if (Array.isArray(actionsOrOptions)) {
      // Overload: every(interval, conditions, actions, options?)
      conditions = actionsOrConditions as readonly ConditionFn<TState>[];
      actions = actionsOrOptions as readonly ActionFn<TState>[];
      options = optionsOptional;
    } else {
      // Overload: every(interval, actions, options?)
      actions = actionsOrConditions as readonly ActionFn<TState>[];
      options = actionsOrOptions as EveryOptions | undefined;
    }

    const triggerId = this._generateTriggerId();
    let ready = false;

    const check: TriggerFn<TState> = (): boolean => {
      if (ready) {
        ready = false;
        return true;
      }
      return false;
    };

    const stop = (clearReady: boolean): void => {
      const timer = this._scheduleTimers.get(triggerId);
      if (timer) {
        clearTimeout(timer);
        this._scheduleTimers.delete(triggerId);
      }
      if (clearReady) {
        ready = false;
      }
    };

    const scheduleNext = (): void => {
      if (!this._triggers.has(triggerId)) {
        return;
      }
      if (this._scheduleTimers.has(triggerId)) {
        return;
      }
      const timer = setTimeout(() => {
        this._scheduleTimers.delete(triggerId);
        if (!this._triggers.has(triggerId)) {
          return;
        }
        ready = true;
        this._stateChanged = true;
        this._wake();
        scheduleNext();
      }, intervalMs);
      this._scheduleTimers.set(triggerId, timer);
    };

    this.addTrigger({
      id: triggerId,
      check,
      conditions,
      actions,
      repeat: true,
      priority: options?.priority,
      maxFires: options?.maxFires,
    });
    this._scheduleControllers.set(triggerId, { start: scheduleNext, stop });
    if (this.isRunning() || this.isPaused()) {
      scheduleNext();
    }

    if (options?.immediate === true) {
      ready = true;
      this._stateChanged = true;
      this._wake();
    }

    return triggerId;
  }
}
