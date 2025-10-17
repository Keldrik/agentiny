import { describe, it, expect, vi } from 'vitest';
import { evaluateConditions } from './index';

describe('evaluateConditions', () => {
  describe('basic evaluation', () => {
    it('should return true for empty conditions', async () => {
      const result = await evaluateConditions([], {});
      expect(result).toBe(true);
    });

    it('should return true when all conditions pass', async () => {
      const conditions = [
        (state: { count: number }) => state.count > 0,
        (state: { count: number }) => state.count < 10,
      ];

      const result = await evaluateConditions(conditions, { count: 5 });
      expect(result).toBe(true);
    });

    it('should return false when one condition fails', async () => {
      const conditions = [
        (state: { count: number }) => state.count > 0,
        (state: { count: number }) => state.count < 10,
      ];

      const result = await evaluateConditions(conditions, { count: 15 });
      expect(result).toBe(false);
    });

    it('should return false when first condition fails', async () => {
      const conditions = [
        (state: { count: number }) => state.count < 0,
        (state: { count: number }) => state.count > 0,
      ];

      const result = await evaluateConditions(conditions, { count: 5 });
      expect(result).toBe(false);
    });
  });

  describe('short-circuiting', () => {
    it('should stop evaluating after first failure', async () => {
      const condition1 = vi.fn(() => false);
      const condition2 = vi.fn(() => true);

      const conditions = [condition1, condition2];

      await evaluateConditions(conditions, {});

      expect(condition1).toHaveBeenCalled();
      expect(condition2).not.toHaveBeenCalled();
    });

    it('should evaluate all conditions if all pass', async () => {
      const condition1 = vi.fn(() => true);
      const condition2 = vi.fn(() => true);

      const conditions = [condition1, condition2];

      await evaluateConditions(conditions, {});

      expect(condition1).toHaveBeenCalled();
      expect(condition2).toHaveBeenCalled();
    });
  });

  describe('async conditions', () => {
    it('should handle async conditions', async () => {
      const conditions = [
        async (state: { count: number }) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return state.count > 0;
        },
      ];

      const result = await evaluateConditions(conditions, { count: 5 });
      expect(result).toBe(true);
    });

    it('should handle mixed sync and async conditions', async () => {
      const conditions = [
        (state: { count: number }) => state.count > 0,
        async (state: { count: number }) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return state.count < 100;
        },
      ];

      const result = await evaluateConditions(conditions, { count: 50 });
      expect(result).toBe(true);
    });

    it('should short-circuit on async condition failure', async () => {
      const condition1 = vi.fn(async (state: { count: number }) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return state.count > 100;
      });
      const condition2 = vi.fn(() => true);

      const conditions = [condition1, condition2];

      const result = await evaluateConditions(conditions, { count: 5 });

      expect(result).toBe(false);
      expect(condition1).toHaveBeenCalled();
      expect(condition2).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should return false on error without throwing', async () => {
      const conditions = [
        () => {
          throw new Error('Condition error');
        },
      ];

      const result = await evaluateConditions(conditions, {});
      expect(result).toBe(false);
    });

    it('should short-circuit on error', async () => {
      const condition1 = vi.fn(() => {
        throw new Error('First condition error');
      });
      const condition2 = vi.fn(() => true);

      const conditions = [condition1, condition2];

      const result = await evaluateConditions(conditions, {});

      expect(result).toBe(false);
      expect(condition1).toHaveBeenCalled();
      expect(condition2).not.toHaveBeenCalled();
    });

    it('should handle async errors', async () => {
      const conditions = [
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          throw new Error('Async error');
        },
      ];

      const result = await evaluateConditions(conditions, {});
      expect(result).toBe(false);
    });
  });

  describe('state passing', () => {
    it('should pass state to each condition', async () => {
      const condition1 = vi.fn(() => true);
      const condition2 = vi.fn(() => true);

      const state = { count: 42, name: 'test' };
      const conditions = [condition1, condition2];

      await evaluateConditions(conditions, state);

      expect(condition1).toHaveBeenCalledWith(state);
      expect(condition2).toHaveBeenCalledWith(state);
    });
  });

  describe('edge cases', () => {
    it('should handle single condition', async () => {
      const conditions = [(state: { count: number }) => state.count > 5];

      const result = await evaluateConditions(conditions, { count: 10 });
      expect(result).toBe(true);
    });

    it('should handle many conditions', async () => {
      const conditions = Array.from({ length: 10 }, () => () => true);

      const result = await evaluateConditions(conditions, {});
      expect(result).toBe(true);
    });

    it('should handle readonly array', async () => {
      const conditions: readonly ((state: object) => boolean)[] = [() => true, () => true];

      const result = await evaluateConditions(conditions, {});
      expect(result).toBe(true);
    });
  });
});
