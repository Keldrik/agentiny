/**
 * Minimal reactive state container
 *
 * @template T - The type of the state value
 */
export class State<T> {
  private _value: T;
  private _subscribers: Set<(value: T) => void>;

  /**
   * Create a new State instance
   *
   * @param initialValue - The initial state value
   */
  constructor(initialValue: T) {
    this._value = initialValue;
    this._subscribers = new Set();
  }

  /**
   * Get the current state value
   *
   * @returns Current state value
   */
  get(): T {
    return this._value;
  }

  /**
   * Set a new state value and notify subscribers
   *
   * @param value - New state value
   */
  set(value: T): void {
    this._value = value;
    this._notify();
  }

  /**
   * Subscribe to state changes
   *
   * @param callback - Function called with new state value
   * @returns Unsubscribe function
   */
  subscribe(callback: (value: T) => void): () => void {
    this._subscribers.add(callback);
    return () => this._subscribers.delete(callback);
  }

  /**
   * Notify all subscribers of state change
   *
   * Errors thrown by subscriber callbacks are caught and logged to console
   * to prevent one subscriber's error from preventing other subscribers from
   * being notified.
   */
  private _notify(): void {
    this._subscribers.forEach((cb) => {
      try {
        cb(this._value);
      } catch (error) {
        // Log error but continue notifying other subscribers
        // eslint-disable-next-line no-undef
        console.error('Error in state subscriber:', error);
      }
    });
  }
}
