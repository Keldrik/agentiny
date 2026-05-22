import { describe, it, expect, beforeEach, vi } from 'vitest';
import { State } from './index';

describe('State', () => {
  let state: State<{ value: number }>;

  beforeEach(() => {
    state = new State({ value: 0 });
  });

  describe('initialization', () => {
    it('should create state with initial value', () => {
      expect(state.get()).toEqual({ value: 0 });
    });

    it('should support any type', () => {
      const stringState = new State('hello');
      expect(stringState.get()).toBe('hello');

      const numberState = new State(42);
      expect(numberState.get()).toBe(42);

      const arrayState = new State([1, 2, 3]);
      expect(arrayState.get()).toEqual([1, 2, 3]);
    });
  });

  describe('get/set', () => {
    it('should get current value', () => {
      expect(state.get()).toEqual({ value: 0 });
    });

    it('should set new value', () => {
      state.set({ value: 10 });
      expect(state.get()).toEqual({ value: 10 });
    });

    it('should overwrite previous value', () => {
      state.set({ value: 5 });
      state.set({ value: 15 });
      expect(state.get()).toEqual({ value: 15 });
    });
  });

  describe('reference-equality short-circuit', () => {
    it('should not notify when setting the exact same reference', () => {
      const callback = vi.fn();
      state.subscribe(callback);

      const current = state.get();
      state.set(current);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should notify for a distinct but deep-equal object', () => {
      const callback = vi.fn();
      state.subscribe(callback);

      // Same shape/values as initial { value: 0 } but a new reference.
      state.set({ value: 0 });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ value: 0 });
    });

    it('should not notify when setting an identical primitive value', () => {
      const numberState = new State(42);
      const callback = vi.fn();
      numberState.subscribe(callback);

      numberState.set(42);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should treat NaN as unchanged (Object.is, not ===)', () => {
      const nanState = new State(Number.NaN);
      const callback = vi.fn();
      nanState.subscribe(callback);

      nanState.set(Number.NaN);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('subscribe', () => {
    it('should call subscriber on state change', () => {
      const callback = vi.fn();
      state.subscribe(callback);

      state.set({ value: 5 });

      expect(callback).toHaveBeenCalledWith({ value: 5 });
    });

    it('should call with new value', () => {
      const callback = vi.fn();
      state.subscribe(callback);

      const newValue = { value: 42 };
      state.set(newValue);

      expect(callback).toHaveBeenCalledWith(newValue);
    });

    it('should support multiple subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      state.subscribe(callback1);
      state.subscribe(callback2);

      state.set({ value: 5 });

      expect(callback1).toHaveBeenCalledWith({ value: 5 });
      expect(callback2).toHaveBeenCalledWith({ value: 5 });
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = state.subscribe(callback);

      unsubscribe();
      state.set({ value: 5 });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should allow unsubscribing specific callback', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsub1 = state.subscribe(callback1);
      state.subscribe(callback2);

      unsub1();
      state.set({ value: 5 });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith({ value: 5 });
    });

    it('should handle subscriber errors gracefully', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Subscriber error');
      });
      const normalCallback = vi.fn();

      state.subscribe(errorCallback);
      state.subscribe(normalCallback);

      // Should not throw
      expect(() => {
        state.set({ value: 5 });
      }).not.toThrow();

      // Both callbacks should be called despite error
      expect(errorCallback).toHaveBeenCalled();
      expect(normalCallback).toHaveBeenCalled();
    });

    it('should not notify subscribers if unsubscribed', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsub1 = state.subscribe(callback1);
      state.subscribe(callback2);

      unsub1();

      state.set({ value: 10 });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith({ value: 10 });
    });

    it('should support resubscribing after unsubscribe', () => {
      const callback = vi.fn();

      const unsub = state.subscribe(callback);
      unsub();

      state.set({ value: 5 });
      expect(callback).not.toHaveBeenCalled();

      state.subscribe(callback);
      state.set({ value: 10 });

      expect(callback).toHaveBeenCalledWith({ value: 10 });
    });
  });

  describe('immutability', () => {
    it('should return current value on get', () => {
      const value = state.get();
      expect(value).toEqual({ value: 0 });
    });

    it('should allow setting to same reference', () => {
      const value = state.get();
      expect(() => {
        state.set(value);
      }).not.toThrow();
    });
  });

  describe('complex types', () => {
    it('should handle object state', () => {
      const objectState = new State({
        count: 0,
        name: 'test',
        nested: { deep: 'value' },
      });

      objectState.set({
        count: 5,
        name: 'updated',
        nested: { deep: 'new' },
      });

      expect(objectState.get()).toEqual({
        count: 5,
        name: 'updated',
        nested: { deep: 'new' },
      });
    });

    it('should handle array state', () => {
      const arrayState = new State([1, 2, 3]);

      arrayState.set([4, 5, 6]);

      expect(arrayState.get()).toEqual([4, 5, 6]);
    });

    it('should handle null', () => {
      const nullState = new State<{ value: number } | null>(null);

      expect(nullState.get()).toBeNull();

      nullState.set({ value: 5 });
      expect(nullState.get()).toEqual({ value: 5 });
    });
  });
});
