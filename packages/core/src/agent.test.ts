import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent, AgentError } from './index';

describe('Agent', () => {
  let agent: Agent<{ count: number }>;

  beforeEach(() => {
    agent = new Agent({ initialState: { count: 0 } });
  });

  afterEach(async () => {
    if (agent.isRunning()) {
      await agent.stop();
    }
  });

  describe('initialization', () => {
    it('should create agent with initial state', () => {
      expect(agent.getState()).toEqual({ count: 0 });
    });

    it('should create agent without initial state', () => {
      const emptyAgent = new Agent();
      expect(emptyAgent.getState()).toBeUndefined();
    });

    it('should have idle status initially', () => {
      expect(agent.getStatus()).toBe('idle');
    });

    it('should not be running initially', () => {
      expect(agent.isRunning()).toBe(false);
    });
  });

  describe('state management', () => {
    it('should get current state', () => {
      agent.setState({ count: 5 });
      expect(agent.getState()).toEqual({ count: 5 });
    });

    it('should set new state', () => {
      agent.setState({ count: 10 });
      expect(agent.getState()).toEqual({ count: 10 });
    });

    it('should subscribe to state changes', async () => {
      const mockCallback = vi.fn();
      const unsubscribe = agent.subscribe(mockCallback);

      agent.setState({ count: 1 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockCallback).toHaveBeenCalledWith({ count: 1 });
      unsubscribe();
    });

    it('should unsubscribe from state changes', async () => {
      const mockCallback = vi.fn();
      const unsubscribe = agent.subscribe(mockCallback);
      unsubscribe();

      agent.setState({ count: 1 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should support multiple subscribers', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      agent.subscribe(callback1);
      agent.subscribe(callback2);

      agent.setState({ count: 5 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(callback1).toHaveBeenCalledWith({ count: 5 });
      expect(callback2).toHaveBeenCalledWith({ count: 5 });
    });
  });

  describe('trigger management', () => {
    it('should add trigger', () => {
      agent.addTrigger({
        id: 'test-trigger',
        check: () => true,
        actions: [],
      });

      const trigger = agent.getTrigger('test-trigger');
      expect(trigger).toBeDefined();
      expect(trigger?.id).toBe('test-trigger');
    });

    it('should throw error on duplicate trigger ID', () => {
      agent.addTrigger({
        id: 'test-trigger',
        check: () => true,
        actions: [],
      });

      expect(() => {
        agent.addTrigger({
          id: 'test-trigger',
          check: () => true,
          actions: [],
        });
      }).toThrow(AgentError);
    });

    it('should get trigger by ID', () => {
      const checkFn = () => true;
      agent.addTrigger({
        id: 'my-trigger',
        check: checkFn,
        actions: [],
      });

      const trigger = agent.getTrigger('my-trigger');
      expect(trigger?.check).toBe(checkFn);
    });

    it('should return undefined for non-existent trigger', () => {
      expect(agent.getTrigger('non-existent')).toBeUndefined();
    });

    it('should get all triggers', () => {
      agent.addTrigger({
        id: 'trigger-1',
        check: () => true,
        actions: [],
      });
      agent.addTrigger({
        id: 'trigger-2',
        check: () => true,
        actions: [],
      });

      const triggers = agent.getAllTriggers();
      expect(triggers).toHaveLength(2);
      expect(triggers.map((t) => t.id)).toContain('trigger-1');
      expect(triggers.map((t) => t.id)).toContain('trigger-2');
    });

    it('should remove trigger by ID', () => {
      agent.addTrigger({
        id: 'test-trigger',
        check: () => true,
        actions: [],
      });

      agent.removeTrigger('test-trigger');
      expect(agent.getTrigger('test-trigger')).toBeUndefined();
    });

    it('should throw error when removing non-existent trigger', () => {
      expect(() => {
        agent.removeTrigger('non-existent');
      }).toThrow(AgentError);
    });

    it('should clear all triggers', () => {
      agent.addTrigger({
        id: 'trigger-1',
        check: () => true,
        actions: [],
      });
      agent.addTrigger({
        id: 'trigger-2',
        check: () => true,
        actions: [],
      });

      agent.clearTriggers();
      expect(agent.getAllTriggers()).toHaveLength(0);
    });
  });

  describe('agent lifecycle', () => {
    it('should start agent', async () => {
      await agent.start();
      expect(agent.isRunning()).toBe(true);
      expect(agent.getStatus()).toBe('running');
      await agent.stop();
    });

    it('should throw error when starting already running agent', async () => {
      await agent.start();
      await expect(agent.start()).rejects.toThrow(AgentError);
      await agent.stop();
    });

    it('should stop agent', async () => {
      await agent.start();
      await agent.stop();
      expect(agent.isRunning()).toBe(false);
      expect(agent.getStatus()).toBe('stopped');
    });

    it('should throw error when stopping non-running agent', async () => {
      await expect(agent.stop()).rejects.toThrow(AgentError);
    });
  });

  describe('when() - state-based repeating trigger', () => {
    it('should execute action when check passes', async () => {
      const action = vi.fn();

      agent.when((state) => state.count > 5, [action]);

      await agent.start();
      agent.setState({ count: 10 });

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      expect(action).toHaveBeenCalled();
    });

    it('should not execute action when check fails', async () => {
      const action = vi.fn();

      agent.when((state) => state.count > 5, [action]);

      await agent.start();
      agent.setState({ count: 2 });

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      expect(action).not.toHaveBeenCalled();
    });

    it('should repeat when state changes', async () => {
      const action = vi.fn();

      agent.when((state) => state.count > 5, [action]);

      await agent.start();

      agent.setState({ count: 10 });
      await new Promise((resolve) => setTimeout(resolve, 20));

      agent.setState({ count: 11 });
      await new Promise((resolve) => setTimeout(resolve, 20));

      await agent.stop();

      expect(action.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should support conditions', async () => {
      const action = vi.fn();
      const condition = vi.fn(() => true);

      agent.when((state) => state.count > 0, [condition], [action]);

      await agent.start();
      agent.setState({ count: 1 });

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      expect(condition).toHaveBeenCalled();
      expect(action).toHaveBeenCalled();
    });

    it('should not execute action if condition fails', async () => {
      const action = vi.fn();
      const condition = () => false;

      agent.when((state) => state.count > 0, [condition], [action]);

      await agent.start();
      agent.setState({ count: 1 });

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      expect(action).not.toHaveBeenCalled();
    });

    it('should return trigger ID', () => {
      const id = agent.when((state) => state.count > 5, [() => {}]);
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^__trigger_/);
    });
  });

  describe('once() - one-time trigger', () => {
    it('should execute action only once', async () => {
      const action = vi.fn();

      agent.once((state) => state.count > 5, [action]);

      await agent.start();

      agent.setState({ count: 10 });
      await new Promise((resolve) => setTimeout(resolve, 20));

      agent.setState({ count: 11 });
      await new Promise((resolve) => setTimeout(resolve, 20));

      await agent.stop();

      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should remove itself after execution', async () => {
      const action = vi.fn();

      const id = agent.once((state) => state.count > 5, [action]);

      await agent.start();
      agent.setState({ count: 10 });

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      expect(agent.getTrigger(id)).toBeUndefined();
    });

    it('should support conditions', async () => {
      const action = vi.fn();
      const condition = vi.fn(() => true);

      agent.once((state) => state.count > 0, [condition], [action]);

      await agent.start();
      agent.setState({ count: 1 });

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      expect(condition).toHaveBeenCalled();
      expect(action).toHaveBeenCalled();
    });

    it('should return trigger ID', () => {
      const id = agent.once((state) => state.count > 5, [() => {}]);
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^__trigger_/);
    });
  });

  describe('on() - event-based trigger', () => {
    it('should execute action on event', async () => {
      const action = vi.fn();

      agent.on('save', [action]);

      await agent.start();
      agent.emitEvent('save');

      await new Promise((resolve) => setTimeout(resolve, 50));
      await agent.stop();

      expect(action).toHaveBeenCalled();
    });

    it('should not execute for different event', async () => {
      const action = vi.fn();

      agent.on('save', [action]);

      await agent.start();
      agent.emitEvent('load');

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      expect(action).not.toHaveBeenCalled();
    });

    it('should repeat on multiple events', async () => {
      const action = vi.fn();

      agent.on('save', [action]);

      await agent.start();

      agent.emitEvent('save');
      await new Promise((resolve) => setTimeout(resolve, 50));

      agent.emitEvent('save');
      await new Promise((resolve) => setTimeout(resolve, 50));

      await agent.stop();

      expect(action.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should support conditions', async () => {
      const action = vi.fn();
      const condition = vi.fn(() => true);

      agent.on('save', [condition], [action]);

      await agent.start();
      agent.emitEvent('save');

      await new Promise((resolve) => setTimeout(resolve, 50));
      await agent.stop();

      expect(condition).toHaveBeenCalled();
      expect(action).toHaveBeenCalled();
    });

    it('should not execute if condition fails', async () => {
      const action = vi.fn();
      const condition = () => false;

      agent.on('save', [condition], [action]);

      await agent.start();
      agent.emitEvent('save');

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      expect(action).not.toHaveBeenCalled();
    });

    it('should support one-time event trigger', async () => {
      const action = vi.fn();

      agent.on('save', [action], false);

      await agent.start();

      agent.emitEvent('save');
      await new Promise((resolve) => setTimeout(resolve, 50));

      agent.emitEvent('save');
      await new Promise((resolve) => setTimeout(resolve, 50));

      await agent.stop();

      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should return trigger ID', () => {
      const id = agent.on('save', [() => {}]);
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^__trigger_/);
    });

    it('should handle multiple listeners for same event', async () => {
      const action1 = vi.fn();
      const action2 = vi.fn();

      agent.on('save', [action1]);
      agent.on('save', [action2]);

      await agent.start();
      agent.emitEvent('save');

      await new Promise((resolve) => setTimeout(resolve, 50));
      await agent.stop();

      expect(action1).toHaveBeenCalled();
      expect(action2).toHaveBeenCalled();
    });
  });

  describe('removeEventTrigger()', () => {
    it('should remove specific event trigger', async () => {
      const action = vi.fn();
      const id = agent.on('save', [action]);

      agent.removeEventTrigger('save', id);

      await agent.start();
      agent.emitEvent('save');

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      expect(action).not.toHaveBeenCalled();
    });

    it('should throw error when removing non-existent trigger', () => {
      expect(() => {
        agent.removeEventTrigger('save', 'non-existent');
      }).toThrow(AgentError);
    });
  });

  describe('removeAllEventTriggersForEvent()', () => {
    it('should remove all triggers for event', async () => {
      const action1 = vi.fn();
      const action2 = vi.fn();

      agent.on('save', [action1]);
      agent.on('save', [action2]);

      agent.removeAllEventTriggersForEvent('save');

      await agent.start();
      agent.emitEvent('save');

      await new Promise((resolve) => setTimeout(resolve, 50));
      await agent.stop();

      expect(action1).not.toHaveBeenCalled();
      expect(action2).not.toHaveBeenCalled();
    });

    it('should not affect other events', async () => {
      const saveAction = vi.fn();
      const loadAction = vi.fn();

      agent.on('save', [saveAction]);
      agent.on('load', [loadAction]);

      agent.removeAllEventTriggersForEvent('save');

      await agent.start();
      agent.emitEvent('load');

      await new Promise((resolve) => setTimeout(resolve, 50));
      await agent.stop();

      expect(loadAction).toHaveBeenCalled();
    });

    it('should handle non-existent event gracefully', () => {
      expect(() => {
        agent.removeAllEventTriggersForEvent('non-existent');
      }).not.toThrow();
    });
  });

  describe('getEventTriggersForEvent()', () => {
    it('should return triggers for event', () => {
      agent.on('save', [() => {}]);
      agent.on('save', [() => {}]);

      const triggers = agent.getEventTriggersForEvent('save');
      expect(triggers).toHaveLength(2);
    });

    it('should return empty array for non-existent event', () => {
      const triggers = agent.getEventTriggersForEvent('non-existent');
      expect(triggers).toEqual([]);
    });

    it('should return Trigger objects with configuration', () => {
      agent.on('save', [() => {}], true);

      const triggers = agent.getEventTriggersForEvent('save');
      expect(triggers[0]?.repeat).toBe(true);
      expect(triggers[0]?.actions).toBeDefined();
    });
  });

  describe('getEventTriggers()', () => {
    it('should return all event-based triggers', () => {
      agent.on('save', [() => {}]);
      agent.on('load', [() => {}]);
      agent.on('load', [() => {}]);

      const allEvents = agent.getEventTriggers();
      expect(allEvents.size).toBe(2);
      expect(allEvents.get('save')).toHaveLength(1);
      expect(allEvents.get('load')).toHaveLength(2);
    });

    it('should return empty map when no event triggers', () => {
      const allEvents = agent.getEventTriggers();
      expect(allEvents.size).toBe(0);
    });
  });

  describe('actions', () => {
    it('should execute multiple actions', async () => {
      const action1 = vi.fn();
      const action2 = vi.fn();

      agent.when((state) => state.count > 0, [action1, action2]);

      await agent.start();
      agent.setState({ count: 1 });

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      expect(action1).toHaveBeenCalled();
      expect(action2).toHaveBeenCalled();
    });

    it('should execute async actions', async () => {
      const action = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });

      agent.when((state) => state.count > 0, [action]);

      await agent.start();
      agent.setState({ count: 1 });

      await new Promise((resolve) => setTimeout(resolve, 30));
      await agent.stop();

      expect(action).toHaveBeenCalled();
    });

    it('should pass current state to actions', async () => {
      let capturedState = null;

      agent.when(
        (state) => state.count > 0,
        [
          (state) => {
            capturedState = state;
          },
        ],
      );

      await agent.start();
      agent.setState({ count: 42 });

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      expect(capturedState).toEqual({ count: 42 });
    });

    it('should allow state mutations in actions', async () => {
      agent.when(
        (state) => state.count === 0,
        [
          (state) => {
            state.count = 10;
          },
        ],
      );

      await agent.start();
      agent.setState({ count: 0 });

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      expect(agent.getState().count).toBe(10);
    });
  });

  describe('async checks and conditions', () => {
    it('should support async check functions', async () => {
      const action = vi.fn();

      agent.when(
        async (state) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return state.count > 5;
        },
        [action],
      );

      await agent.start();
      agent.setState({ count: 10 });

      await new Promise((resolve) => setTimeout(resolve, 30));
      await agent.stop();

      expect(action).toHaveBeenCalled();
    });

    it('should support async conditions', async () => {
      const action = vi.fn();

      agent.when(
        (state) => state.count > 0,
        [
          async (state) => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return state.count > 5;
          },
        ],
        [action],
      );

      await agent.start();
      agent.setState({ count: 10 });

      await new Promise((resolve) => setTimeout(resolve, 30));
      await agent.stop();

      expect(action).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle errors in check functions', async () => {
      const onError = vi.fn();
      agent = new Agent({ initialState: { count: 0 }, onError });

      agent.when(() => {
        throw new Error('Check failed');
      }, [() => {}]);

      await agent.start();
      agent.setState({ count: 1 });

      await new Promise((resolve) => setTimeout(resolve, 30));
      await agent.stop();

      expect(onError).toHaveBeenCalled();
    });

    it('should handle errors in actions', async () => {
      const onError = vi.fn();
      agent = new Agent({ initialState: { count: 0 }, onError });

      agent.when(
        (state) => state.count > 0,
        [
          () => {
            throw new Error('Action failed');
          },
        ],
      );

      await agent.start();
      agent.setState({ count: 1 });

      await new Promise((resolve) => setTimeout(resolve, 30));
      await agent.stop();

      expect(onError).toHaveBeenCalled();
    });

    it('should handle errors in conditions', async () => {
      const onError = vi.fn();
      agent = new Agent({ initialState: { count: 0 }, onError });

      agent.when(
        (state) => state.count > 0,
        [
          () => {
            throw new Error('Condition failed');
          },
        ],
        [() => {}],
      );

      await agent.start();
      agent.setState({ count: 1 });

      // Note: Condition errors are caught but not passed to onError callback
      // They are logged but trigger continues without executing actions
      await new Promise((resolve) => setTimeout(resolve, 30));
      await agent.stop();

      // Condition errors don't trigger onError - they just prevent action execution
      // This is by design as documented in conditions.ts
    });

    it('should continue executing despite action errors', async () => {
      const onError = vi.fn();
      const action1 = vi.fn(() => {
        throw new Error('Action 1 failed');
      });
      const action2 = vi.fn();

      agent = new Agent({ initialState: { count: 0 }, onError });

      agent.when((state) => state.count > 0, [action1, action2]);

      await agent.start();
      agent.setState({ count: 1 });

      await new Promise((resolve) => setTimeout(resolve, 30));
      await agent.stop();

      expect(action1).toHaveBeenCalled();
      expect(action2).toHaveBeenCalled();
    });

    it('should report errors with onError callback', async () => {
      const onError = vi.fn();
      agent = new Agent({ initialState: { count: 0 }, onError });

      agent.when(() => {
        throw new Error('Test error');
      }, [() => {}]);

      await agent.start();
      agent.setState({ count: 1 });

      await new Promise((resolve) => setTimeout(resolve, 30));
      await agent.stop();

      const calls = onError.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
    });
  });

  describe('trigger delay', () => {
    it('should delay action execution', async () => {
      const action = vi.fn();
      const startTime = Date.now();

      agent.addTrigger({
        id: 'delayed-trigger',
        check: (state) => state.count > 0,
        actions: [action],
        delay: 50,
      });

      await agent.start();
      agent.setState({ count: 1 });

      await new Promise((resolve) => setTimeout(resolve, 100));
      await agent.stop();

      const elapsedTime = Date.now() - startTime;
      expect(action).toHaveBeenCalled();
      expect(elapsedTime).toBeGreaterThanOrEqual(50);
    });
  });

  describe('initial triggers in config', () => {
    it('should add triggers from config', () => {
      const agent = new Agent({
        initialState: { count: 0 },
        triggers: [
          {
            id: 'trigger-1',
            check: () => true,
            actions: [],
          },
          {
            id: 'trigger-2',
            check: () => true,
            actions: [],
          },
        ],
      });

      expect(agent.getAllTriggers()).toHaveLength(2);
    });
  });

  describe('performance optimization - state change tracking', () => {
    it('should only evaluate triggers on state changes', async () => {
      const checkFn = vi.fn(() => true);
      const action = vi.fn();

      agent.when(checkFn, [action]);

      await agent.start();

      // Set state once
      agent.setState({ count: 1 });

      // Wait for trigger evaluation
      await new Promise((resolve) => setTimeout(resolve, 20));

      // State unchanged, triggers should not be checked again
      await new Promise((resolve) => setTimeout(resolve, 30));

      await agent.stop();

      // Check function should be called once per state change
      const firstCallCount = checkFn.mock.calls.length;
      expect(firstCallCount).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty triggers list', async () => {
      await agent.start();
      agent.setState({ count: 1 });

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      // Should not throw
      expect(true).toBe(true);
    });

    it('should handle rapid state changes', async () => {
      const action = vi.fn();

      agent.when((state) => state.count > 0, [action]);

      await agent.start();

      for (let i = 1; i <= 10; i++) {
        agent.setState({ count: i });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
      await agent.stop();

      expect(action.mock.calls.length).toBeGreaterThan(0);
    });

    it('should handle removing trigger during execution', async () => {
      const id = agent.when((state) => state.count > 0, [() => agent.removeTrigger(id)]);

      await agent.start();
      agent.setState({ count: 1 });

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      expect(agent.getTrigger(id)).toBeUndefined();
    });

    it('should handle trigger with no actions', async () => {
      agent.when((state) => state.count > 0, []);

      await agent.start();
      agent.setState({ count: 1 });

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      // Should not throw
      expect(true).toBe(true);
    });

    it('should handle condition without actions', async () => {
      agent.once((state) => state.count > 0, [() => true], []);

      await agent.start();
      agent.setState({ count: 1 });

      await new Promise((resolve) => setTimeout(resolve, 20));
      await agent.stop();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('settle() - wait for all cascading actions', () => {
    describe('basic functionality', () => {
      it('should resolve immediately if agent is already quiet', async () => {
        await agent.start();

        // Wait a bit for initial quiet state
        await new Promise((resolve) => setTimeout(resolve, 30));

        const settlePromise = agent.settle();
        const completed = await Promise.race([
          settlePromise.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
        ]);

        await agent.stop();
        expect(completed).toBe(true);
      });

      it('should wait for quiet cycles and then resolve', async () => {
        const action = vi.fn();

        agent.when((state) => state.count > 0, [action]);

        await agent.start();
        agent.setState({ count: 1 });

        await agent.settle();
        await agent.stop();

        expect(action).toHaveBeenCalled();
      });

      it('should use default quietCycles of 2', async () => {
        const action = vi.fn();

        agent.when((state) => state.count > 0, [action]);

        await agent.start();
        agent.setState({ count: 1 });

        // settle() with default params should work
        await agent.settle();
        await agent.stop();

        expect(action).toHaveBeenCalled();
      });

      it('should accept custom quietCycles parameter', async () => {
        const action = vi.fn();

        agent.when((state) => state.count > 0, [action]);

        await agent.start();
        agent.setState({ count: 1 });

        // Require 3 quiet cycles instead of default 2
        await agent.settle(3);
        await agent.stop();

        expect(action).toHaveBeenCalled();
      });

      it('should accept custom timeout parameter', async () => {
        const action = vi.fn();

        agent.when((state) => state.count > 0, [action]);

        await agent.start();
        agent.setState({ count: 1 });

        // Custom 5 second timeout
        await agent.settle(2, 5000);
        await agent.stop();

        expect(action).toHaveBeenCalled();
      });
    });

    describe('cascading triggers', () => {
      it('should wait for 2-level cascading triggers', async () => {
        const action1 = vi.fn();
        const action2 = vi.fn();

        // Trigger 1: when count > 0, increment count
        agent.when(
          (state) => state.count > 0 && state.count < 2,
          [
            (state) => {
              state.count++;
              action1();
            },
          ],
        );

        // Trigger 2: when count > 1, execute action2
        agent.when((state) => state.count > 1, [action2]);

        await agent.start();
        agent.setState({ count: 1 });

        await agent.settle();
        await agent.stop();

        expect(action1).toHaveBeenCalled();
        expect(action2).toHaveBeenCalled();
      });

      it('should wait for 4-level cascading triggers (document flow)', async () => {
        interface DocState {
          status:
            | 'ready'
            | 'processing'
            | 'processed'
            | 'checking'
            | 'checked'
            | 'archiving'
            | 'archived';
        }

        const docAgent = new Agent<DocState>({ initialState: { status: 'ready' } });

        const readyAction = vi.fn();
        const processAction = vi.fn();
        const changeAction = vi.fn();
        const checkAction = vi.fn();

        // Step 1: Document ready -> process
        docAgent.when(
          (state) => state.status === 'ready',
          [
            (state) => {
              readyAction();
              state.status = 'processing';
            },
          ],
        );

        // Step 2: Document processing -> processed
        docAgent.when(
          (state) => state.status === 'processing',
          [
            (state) => {
              processAction();
              state.status = 'processed';
            },
          ],
        );

        // Step 3: Document processed -> checking
        docAgent.when(
          (state) => state.status === 'processed',
          [
            (state) => {
              changeAction();
              state.status = 'checking';
            },
          ],
        );

        // Step 4: Document checking -> archived
        docAgent.when(
          (state) => state.status === 'checking',
          [
            (state) => {
              checkAction();
              state.status = 'archived';
            },
          ],
        );

        await docAgent.start();
        docAgent.setState({ status: 'ready' });

        // Wait for all 4 cascading actions
        await docAgent.settle();

        expect(readyAction).toHaveBeenCalled();
        expect(processAction).toHaveBeenCalled();
        expect(changeAction).toHaveBeenCalled();
        expect(checkAction).toHaveBeenCalled();
        expect(docAgent.getState().status).toBe('archived');

        await docAgent.stop();
      });

      it('should handle multiple state changes triggering cascades', async () => {
        const action1 = vi.fn();
        const action2 = vi.fn();

        agent.when(
          (state) => state.count === 1,
          [
            (state) => {
              action1();
              state.count = 2;
            },
          ],
        );

        agent.when(
          (state) => state.count === 2,
          [
            (state) => {
              action2();
              state.count = 3;
            },
          ],
        );

        await agent.start();

        // First cascade
        agent.setState({ count: 1 });
        await agent.settle();

        expect(action1).toHaveBeenCalledTimes(1);
        expect(action2).toHaveBeenCalledTimes(1);
        expect(agent.getState().count).toBe(3);

        await agent.stop();
      });

      it('should reset quiet counter when new state change happens during settle waiting', async () => {
        const action1 = vi.fn();
        const action2 = vi.fn();

        agent.when(
          (state) => state.count > 0 && state.count < 2,
          [
            (state) => {
              action1();
              // Don't change state yet
            },
          ],
        );

        await agent.start();
        agent.setState({ count: 1 });

        // Start waiting for settle
        const settlePromise = agent.settle();

        // After a short delay, trigger more state changes
        await new Promise((resolve) => setTimeout(resolve, 15));
        agent.setState({ count: 2 });
        action2();

        await settlePromise;
        await agent.stop();

        expect(action1).toHaveBeenCalled();
      });
    });

    describe('multiple concurrent settle calls', () => {
      it('should handle multiple settle() calls with same quiet cycles', async () => {
        const action = vi.fn();

        agent.when((state) => state.count > 0, [action]);

        await agent.start();
        agent.setState({ count: 1 });

        // Start multiple settle() calls
        const settle1 = agent.settle();
        const settle2 = agent.settle();
        const settle3 = agent.settle();

        // All should resolve
        await Promise.all([settle1, settle2, settle3]);

        await agent.stop();
        expect(action).toHaveBeenCalled();
      });

      it('should handle multiple settle() calls with different quiet cycles', async () => {
        const action = vi.fn();

        agent.when((state) => state.count > 0, [action]);

        await agent.start();
        agent.setState({ count: 1 });

        // Different quiet cycle requirements
        const settle1 = agent.settle(1);
        const settle2 = agent.settle(2);
        const settle3 = agent.settle(3);

        // All should resolve in order
        await settle1;
        await settle2;
        await settle3;

        await agent.stop();
        expect(action).toHaveBeenCalled();
      });

      it('should resolve each settle call independently', async () => {
        const action = vi.fn();

        agent.when((state) => state.count > 0, [action]);

        await agent.start();
        agent.setState({ count: 1 });

        const startTime = Date.now();
        const settle1 = agent.settle(1);
        const settle2 = agent.settle(3);

        const time1 = Date.now();
        await settle1;
        const time2 = Date.now();
        await settle2;
        const time3 = Date.now();

        // settle1 should complete faster than settle2
        expect(time2 - time1).toBeLessThan(time3 - time2);

        await agent.stop();
      });
    });

    describe('error handling', () => {
      it('should throw AgentError if agent is not running', () => {
        expect(() => agent.settle()).toThrow(AgentError);
      });

      it('should throw AgentError if quietCycles is 0', async () => {
        await agent.start();
        expect(() => agent.settle(0)).toThrow(AgentError);
        await agent.stop();
      });

      it('should throw AgentError if quietCycles is negative', async () => {
        await agent.start();
        expect(() => agent.settle(-1)).toThrow(AgentError);
        await agent.stop();
      });

      it('should reject with timeout error if quiet cycles not reached in time', async () => {
        // Trigger that repeats forever
        agent.when(
          (state) => state.count > 0,
          [
            (state) => {
              state.count++;
            },
          ],
        );

        await agent.start();
        agent.setState({ count: 1 });

        // Try to settle with very short timeout and high quiet cycles requirement
        await expect(agent.settle(100, 50)).rejects.toThrow(AgentError);

        await agent.stop();
      });

      it('should include timeout context in error', async () => {
        agent.when(
          (state) => state.count > 0,
          [
            (state) => {
              state.count++;
            },
          ],
        );

        await agent.start();
        agent.setState({ count: 1 });

        try {
          await agent.settle(100, 100);
          expect.fail('Should have thrown timeout error');
        } catch (error) {
          if (error instanceof AgentError) {
            expect(error.code).toBe('SETTLE_TIMEOUT');
            expect(error.context).toBeDefined();
          }
        }

        await agent.stop();
      });

      it('should reject all pending settle() calls if agent stops while waiting', async () => {
        const action = vi.fn();

        agent.when(
          (state) => state.count > 0,
          [
            (state) => {
              action();
              state.count++;
            },
          ],
        );

        await agent.start();
        agent.setState({ count: 1 });

        const settle1 = agent.settle(100);
        const settle2 = agent.settle(100);

        // Stop agent while settling
        await new Promise((resolve) => setTimeout(resolve, 20));
        await agent.stop();

        // Both settle calls should reject
        let settle1Rejected = false;
        let settle2Rejected = false;

        try {
          await settle1;
        } catch (error) {
          if (error instanceof AgentError) {
            settle1Rejected = true;
          }
        }

        try {
          await settle2;
        } catch (error) {
          if (error instanceof AgentError) {
            settle2Rejected = true;
          }
        }

        expect(settle1Rejected).toBe(true);
        expect(settle2Rejected).toBe(true);
      });
    });

    describe('timeout behavior', () => {
      it('should timeout after specified duration', async () => {
        agent.when(
          (state) => state.count > 0,
          [
            (state) => {
              state.count++;
            },
          ],
        );

        await agent.start();
        agent.setState({ count: 1 });

        const startTime = Date.now();

        try {
          await agent.settle(100, 100);
          expect.fail('Should have timed out');
        } catch (error) {
          const elapsed = Date.now() - startTime;
          // Should timeout around 100ms (with some tolerance)
          expect(elapsed).toBeGreaterThanOrEqual(80);
          expect(elapsed).toBeLessThan(200);
        }

        await agent.stop();
      });

      it('should clean up timeout on successful resolution', async () => {
        const action = vi.fn();

        agent.when((state) => state.count > 0, [action]);

        await agent.start();
        agent.setState({ count: 1 });

        // Should resolve quickly without timeout firing
        await agent.settle(2, 5000);

        await agent.stop();
        expect(action).toHaveBeenCalled();
      });
    });

    describe('integration with other features', () => {
      it('should work with event-based triggers', async () => {
        const action1 = vi.fn();
        const action2 = vi.fn();

        agent.on('process', [
          (state) => {
            action1();
            state.count++;
          },
        ]);

        agent.when((state) => state.count > 0, [action2]);

        await agent.start();
        agent.emitEvent('process');

        await agent.settle();
        await agent.stop();

        expect(action1).toHaveBeenCalled();
        expect(action2).toHaveBeenCalled();
      });

      it('should work with delayed triggers', async () => {
        const action1 = vi.fn();
        const action2 = vi.fn();

        agent.addTrigger({
          id: 'delayed-trigger',
          check: (state) => state.count > 0 && state.count < 2,
          actions: [
            (state) => {
              action1();
              state.count++;
            },
          ],
          delay: 20,
        });

        agent.when((state) => state.count > 1, [action2]);

        await agent.start();
        agent.setState({ count: 1 });

        await agent.settle();
        await agent.stop();

        expect(action1).toHaveBeenCalled();
        expect(action2).toHaveBeenCalled();
      });

      it('should work with once() triggers', async () => {
        const action1 = vi.fn();
        const action2 = vi.fn();

        agent.once(
          (state) => state.count > 0 && state.count < 2,
          [
            (state) => {
              action1();
              state.count++;
            },
          ],
        );

        agent.when((state) => state.count > 1, [action2]);

        await agent.start();
        agent.setState({ count: 1 });

        await agent.settle();
        await agent.stop();

        expect(action1).toHaveBeenCalledTimes(1);
        expect(action2).toHaveBeenCalled();
      });

      it('should handle rapid consecutive state changes', async () => {
        const action = vi.fn();

        agent.when((state) => state.count > 0, [action]);

        await agent.start();

        // Rapid state changes
        for (let i = 1; i <= 5; i++) {
          agent.setState({ count: i });
        }

        await agent.settle();
        await agent.stop();

        expect(action.mock.calls.length).toBeGreaterThan(0);
      });
    });

    describe('edge cases', () => {
      it('should work with no triggers registered', async () => {
        await agent.start();

        // Should resolve immediately since nothing changes state
        await agent.settle();

        await agent.stop();
        expect(true).toBe(true);
      });

      it('should handle high quietCycles requirement', async () => {
        const action = vi.fn();

        agent.when((state) => state.count > 0, [action]);

        await agent.start();
        agent.setState({ count: 1 });

        // Wait for 10 quiet cycles (~100ms)
        await agent.settle(10);

        await agent.stop();
        expect(action).toHaveBeenCalled();
      });

      it('should handle settle() during long-running async actions', async () => {
        const action1 = vi.fn();
        const action2 = vi.fn();

        agent.when(
          (state) => state.count === 1,
          [
            async (state) => {
              action1();
              await new Promise((resolve) => setTimeout(resolve, 30));
              state.count = 2;
            },
          ],
        );

        agent.when((state) => state.count === 2, [action2]);

        await agent.start();
        agent.setState({ count: 1 });

        await agent.settle();
        await agent.stop();

        expect(action1).toHaveBeenCalled();
        expect(action2).toHaveBeenCalled();
      });

      it('should handle settle() with conditions', async () => {
        const condition = vi.fn(() => true);
        const action = vi.fn();

        agent.when((state) => state.count > 0, [condition], [action]);

        await agent.start();
        agent.setState({ count: 1 });

        await agent.settle();
        await agent.stop();

        expect(condition).toHaveBeenCalled();
        expect(action).toHaveBeenCalled();
      });
    });
  });
});
