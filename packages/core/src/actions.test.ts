import { describe, it, expect, vi } from 'vitest';
import { executeActions } from './index';

describe('executeActions', () => {
  describe('basic execution', () => {
    it('should execute single action', async () => {
      const action = vi.fn();

      const errors = await executeActions([action], {});

      expect(action).toHaveBeenCalled();
      expect(errors).toEqual([]);
    });

    it('should execute multiple actions sequentially', async () => {
      const action1 = vi.fn();
      const action2 = vi.fn();
      const action3 = vi.fn();

      const errors = await executeActions([action1, action2, action3], {});

      expect(action1).toHaveBeenCalled();
      expect(action2).toHaveBeenCalled();
      expect(action3).toHaveBeenCalled();
      expect(errors).toEqual([]);
    });

    it('should pass state to each action', async () => {
      const action1 = vi.fn();
      const action2 = vi.fn();

      const state = { count: 42 };
      const actions = [action1, action2];

      await executeActions(actions, state);

      expect(action1).toHaveBeenCalledWith(state);
      expect(action2).toHaveBeenCalledWith(state);
    });
  });

  describe('empty actions', () => {
    it('should handle empty actions array', async () => {
      const errors = await executeActions([], {});

      expect(errors).toEqual([]);
    });
  });

  describe('async actions', () => {
    it('should handle async actions', async () => {
      const action = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });

      const errors = await executeActions([action], {});

      expect(action).toHaveBeenCalled();
      expect(errors).toEqual([]);
    });

    it('should execute async actions sequentially', async () => {
      const execution: number[] = [];

      const action1 = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        execution.push(1);
      };

      const action2 = async () => {
        execution.push(2);
      };

      await executeActions([action1, action2], {});

      expect(execution).toEqual([1, 2]);
    });

    it('should handle mixed sync and async actions', async () => {
      const action1 = vi.fn();
      const action2 = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      const action3 = vi.fn();

      const errors = await executeActions([action1, action2, action3], {});

      expect(action1).toHaveBeenCalled();
      expect(action2).toHaveBeenCalled();
      expect(action3).toHaveBeenCalled();
      expect(errors).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('should collect errors and continue execution', async () => {
      const action1 = vi.fn(() => {
        throw new Error('Error 1');
      });
      const action2 = vi.fn();
      const action3 = vi.fn(() => {
        throw new Error('Error 2');
      });

      const errors = await executeActions([action1, action2, action3], {});

      expect(action1).toHaveBeenCalled();
      expect(action2).toHaveBeenCalled();
      expect(action3).toHaveBeenCalled();
      expect(errors).toHaveLength(2);
      expect(errors[0]?.message).toBe('Error 1');
      expect(errors[1]?.message).toBe('Error 2');
    });

    it('should wrap non-Error objects in Error', async () => {
      const action = vi.fn(() => {
        throw 'string error';
      });

      const errors = await executeActions([action], {});

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(Error);
      expect(errors[0]?.message).toBe('string error');
    });

    it('should handle async errors', async () => {
      const action = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error('Async error');
      });

      const errors = await executeActions([action], {});

      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toBe('Async error');
    });

    it('should return empty array for successful execution', async () => {
      const action1 = vi.fn();
      const action2 = vi.fn();

      const errors = await executeActions([action1, action2], {});

      expect(errors).toEqual([]);
    });
  });

  describe('state mutations', () => {
    it('should allow actions to mutate state', async () => {
      const state = { count: 0 };

      const actions = [
        (s: { count: number }) => {
          s.count += 1;
        },
      ];

      await executeActions(actions, state);

      expect(state.count).toBe(1);
    });

    it('should persist mutations across actions', async () => {
      const state = { count: 0 };

      const actions = [
        (s: { count: number }) => {
          s.count += 1;
        },
        (s: { count: number }) => {
          s.count += 2;
        },
        (s: { count: number }) => {
          s.count *= 3;
        },
      ];

      await executeActions(actions, state);

      // (0 + 1 + 2) * 3 = 9
      expect(state.count).toBe(9);
    });

    it('should persist mutations even with errors', async () => {
      const state = { count: 0 };

      const actions = [
        (s: { count: number }) => {
          s.count += 1;
        },
        () => {
          throw new Error('Error');
        },
        (s: { count: number }) => {
          s.count += 2;
        },
      ];

      const errors = await executeActions(actions, state);

      expect(state.count).toBe(3);
      expect(errors).toHaveLength(1);
    });
  });

  describe('execution order', () => {
    it('should execute actions in order', async () => {
      const execution: number[] = [];

      const actions = [
        (): void => {
          execution.push(1);
        },
        (): void => {
          execution.push(2);
        },
        (): void => {
          execution.push(3);
        },
      ];

      await executeActions(actions, {});

      expect(execution).toEqual([1, 2, 3]);
    });

    it('should maintain order with async actions', async () => {
      const execution: number[] = [];

      const actions = [
        async (): Promise<void> => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          execution.push(1);
        },
        (): void => {
          execution.push(2);
        },
        async (): Promise<void> => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          execution.push(3);
        },
      ];

      await executeActions(actions, {});

      expect(execution).toEqual([1, 2, 3]);
    });
  });

  describe('edge cases', () => {
    it('should handle action that returns void', async () => {
      const action = (): void => {
        // void return
      };

      const errors = await executeActions([action], {});

      expect(errors).toEqual([]);
    });

    it('should handle action that returns Promise<void>', async () => {
      const action = async (): Promise<void> => {
        // async void
      };

      const errors = await executeActions([action], {});

      expect(errors).toEqual([]);
    });

    it('should handle readonly array', async () => {
      const actions: readonly ((state: object) => void)[] = [() => {}, () => {}];

      const errors = await executeActions(actions, {});

      expect(errors).toEqual([]);
    });

    it('should handle many actions', async () => {
      const actions = Array.from({ length: 100 }, (_, i) =>
        vi.fn((state: { count: number }) => {
          state.count = i;
        }),
      );

      const state = { count: 0 };
      const errors = await executeActions(actions, state);

      expect(errors).toEqual([]);
      expect(state.count).toBe(99);
      expect(actions.length).toBe(100);
    });
  });

  describe('error message preservation', () => {
    it('should preserve error messages', async () => {
      const action = vi.fn(() => {
        throw new Error('Custom error message');
      });

      const errors = await executeActions([action], {});

      expect(errors[0]?.message).toBe('Custom error message');
    });

    it('should preserve error stack', async () => {
      const action = vi.fn(() => {
        throw new Error('Error with stack');
      });

      const errors = await executeActions([action], {});

      expect(errors[0]?.stack).toBeDefined();
    });
  });
});
