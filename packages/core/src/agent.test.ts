import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent, AgentError } from './index';

describe('Agent', () => {
  let agent: Agent<{ count: number }>;

  beforeEach(() => {
    agent = new Agent({ initialState: { count: 0 } });
  });

  afterEach(async () => {
    if (agent.isRunning() || agent.isPaused()) {
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

    it('should use custom logger from config', () => {
      const customLogger = vi.fn();
      const loggedAgent = new Agent({
        initialState: { count: 0 },
        logger: customLogger,
      });

      const unsubscribe = loggedAgent.subscribe(() => {
        throw new Error('test error');
      });

      loggedAgent.setState({ count: 1 });

      expect(customLogger).toHaveBeenCalled();
      unsubscribe();
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

    it('should reject invalid maxFires values', () => {
      for (const maxFires of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
        expect(() => {
          agent.addTrigger({
            id: `invalid-max-fires-${String(maxFires)}`,
            check: () => true,
            actions: [],
            maxFires,
          });
        }).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
      }
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

    it('should clear event tracking maps when clearing triggers', () => {
      agent.on('event1', [() => {}]);
      agent.on('event2', [() => {}]);

      expect(agent.getEventTriggers().size).toBe(2);

      agent.clearTriggers();

      expect(agent.getEventTriggers().size).toBe(0);
      expect(agent.getEventTriggersForEvent('event1')).toEqual([]);
      expect(agent.getEventTriggersForEvent('event2')).toEqual([]);
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

    it('should reject start() while paused and preserve generated trigger IDs', async () => {
      await agent.start();
      const id1 = agent.when((state) => state.count > 0, [vi.fn()]);
      await agent.pause();

      await expect(agent.start()).rejects.toMatchObject({ code: 'AGENT_PAUSED' });
      await agent.resume();

      const id2 = agent.when((state) => state.count > 1, [vi.fn()]);
      expect(id1).toBe('__trigger_1');
      expect(id2).toBe('__trigger_2');
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

    it('should reset trigger ID counter on start', async () => {
      const testAgent = new Agent<{ count: number }>();
      const id1 = testAgent.when(() => true, [() => {}]);
      const id2 = testAgent.when(() => true, [() => {}]);

      const firstCounter = parseInt(id1.replace('__trigger_', ''), 10);
      const secondCounter = parseInt(id2.replace('__trigger_', ''), 10);

      expect(secondCounter).toBe(firstCounter + 1);

      testAgent.clearTriggers();

      await testAgent.start();
      await testAgent.stop();

      const newId = testAgent.when(() => true, [() => {}]);
      const newCounter = parseInt(newId.replace('__trigger_', ''), 10);

      expect(newCounter).toBe(1);
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

      await new Promise((resolve) => setTimeout(resolve, 30));
      await agent.stop();

      expect(onError).toHaveBeenCalled();
      const error = onError.mock.calls[0][0];
      expect(error.message).toBe('Condition failed');
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
            () => {
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
        } catch {
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

  // ─── updateState() ───────────────────────────────────────────────────────────

  describe('updateState()', () => {
    it('should merge partial into current state', () => {
      const a = new Agent({ initialState: { count: 0, name: 'test' } });
      a.updateState({ count: 5 });
      expect(a.getState()).toEqual({ count: 5, name: 'test' });
    });

    it('should preserve fields not in the partial', () => {
      const a = new Agent({ initialState: { count: 0, name: 'hello', flag: true } });
      a.updateState({ count: 42 });
      expect(a.getState().name).toBe('hello');
      expect(a.getState().flag).toBe(true);
    });

    it('should trigger re-evaluation when agent is running', async () => {
      const a = new Agent({ initialState: { count: 0, label: '' } });
      const action = vi.fn();
      a.when((state) => state.count > 0, [action]);
      await a.start();
      a.updateState({ count: 1 });
      await a.settle();
      await a.stop();
      expect(action).toHaveBeenCalled();
    });

    it('should work when agent is stopped', () => {
      const a = new Agent({ initialState: { count: 0, name: 'x' } });
      a.updateState({ name: 'updated' });
      expect(a.getState()).toEqual({ count: 0, name: 'updated' });
    });
  });

  // ─── pause() / resume() ──────────────────────────────────────────────────────

  describe('pause() / resume()', () => {
    it('should pause a running agent', async () => {
      await agent.start();
      await agent.pause();
      expect(agent.isPaused()).toBe(true);
      expect(agent.getStatus()).toBe('paused');
      expect(agent.isRunning()).toBe(false);
    });

    it('should resume a paused agent', async () => {
      await agent.start();
      await agent.pause();
      await agent.resume();
      expect(agent.isRunning()).toBe(true);
      expect(agent.isPaused()).toBe(false);
      expect(agent.getStatus()).toBe('running');
    });

    it('should throw AGENT_ALREADY_PAUSED when pausing twice', async () => {
      await agent.start();
      await agent.pause();
      await expect(agent.pause()).rejects.toThrow(AgentError);
      await expect(agent.pause()).rejects.toMatchObject({ code: 'AGENT_ALREADY_PAUSED' });
    });

    it('should throw AGENT_NOT_RUNNING when pausing an idle agent', async () => {
      await expect(agent.pause()).rejects.toThrow(AgentError);
      await expect(agent.pause()).rejects.toMatchObject({ code: 'AGENT_NOT_RUNNING' });
    });

    it('should throw AGENT_NOT_RUNNING when pausing a stopped agent', async () => {
      await agent.start();
      await agent.stop();
      await expect(agent.pause()).rejects.toMatchObject({ code: 'AGENT_NOT_RUNNING' });
    });

    it('should throw AGENT_NOT_PAUSED when resuming a running agent', async () => {
      await agent.start();
      await expect(agent.resume()).rejects.toMatchObject({ code: 'AGENT_NOT_PAUSED' });
    });

    it('should throw AGENT_NOT_PAUSED when resuming an idle agent', async () => {
      await expect(agent.resume()).rejects.toMatchObject({ code: 'AGENT_NOT_PAUSED' });
    });

    it('should throw AGENT_NOT_PAUSED when resuming a stopped agent', async () => {
      await agent.start();
      await agent.stop();
      await expect(agent.resume()).rejects.toMatchObject({ code: 'AGENT_NOT_PAUSED' });
    });

    it('should not evaluate triggers while paused', async () => {
      const action = vi.fn();
      agent.when((state) => state.count > 0, [action]);
      await agent.start();
      await agent.pause();
      agent.setState({ count: 1 });
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(action).not.toHaveBeenCalled();
    });

    it('should resume trigger evaluation after resume()', async () => {
      const action = vi.fn();
      agent.when((state) => state.count > 0, [action]);
      await agent.start();
      await agent.pause();
      agent.setState({ count: 1 });
      await agent.resume();
      await agent.settle();
      await agent.stop();
      expect(action).toHaveBeenCalled();
    });

    it('should be stoppable from paused state', async () => {
      await agent.start();
      await agent.pause();
      await agent.stop();
      expect(agent.getStatus()).toBe('stopped');
    });

    it('should not reset triggerIdCounter on pause/resume', async () => {
      await agent.start();
      // Add a trigger AFTER start() so the counter advances after the reset
      const id1 = agent.when((state) => state.count > 0, [vi.fn()]);
      await agent.pause();
      await agent.resume();
      // Counter should continue from where it left off, not reset
      const id2 = agent.when((state) => state.count > 1, [vi.fn()]);
      expect(id2).not.toBe(id1);
      expect(id2).toBe('__trigger_2');
    });

    it('should not reject pending settle() promises on pause', async () => {
      agent.when((state) => state.count > 0, [vi.fn()]);
      await agent.start();
      agent.setState({ count: 1 });
      // Start a settle with very high quiet cycles so it won't resolve quickly
      const settlePromise = agent.settle(1000, 5000);
      let rejected = false;
      settlePromise.catch(() => {
        rejected = true;
      });
      await agent.pause();
      // Give it a moment to confirm no rejection
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(rejected).toBe(false);
      // Clean up: stop will reject the pending settle
      await agent.stop();
    });

    it('isPaused() returns false when running', async () => {
      await agent.start();
      expect(agent.isPaused()).toBe(false);
    });

    it('isPaused() returns false when idle', () => {
      expect(agent.isPaused()).toBe(false);
    });
  });

  // ─── disableTrigger() / enableTrigger() / isTriggerDisabled() ────────────────

  describe('disableTrigger() / enableTrigger() / isTriggerDisabled()', () => {
    it('should not fire a disabled trigger', async () => {
      const action = vi.fn();
      agent.addTrigger({ id: 'dt-1', check: (state) => state.count > 0, actions: [action] });
      agent.disableTrigger('dt-1');
      await agent.start();
      agent.setState({ count: 1 });
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(action).not.toHaveBeenCalled();
    });

    it('should fire a trigger after re-enabling it', async () => {
      const action = vi.fn();
      agent.addTrigger({ id: 'dt-2', check: (state) => state.count > 0, actions: [action] });
      agent.disableTrigger('dt-2');
      agent.enableTrigger('dt-2');
      await agent.start();
      agent.setState({ count: 1 });
      await agent.settle();
      expect(action).toHaveBeenCalled();
    });

    it('should evaluate a re-enabled trigger immediately when state already matches', async () => {
      const action = vi.fn();
      agent.addTrigger({ id: 'dt-wake', check: (state) => state.count > 0, actions: [action] });
      await agent.start();
      agent.disableTrigger('dt-wake');
      agent.setState({ count: 1 });
      await agent.settle();
      expect(action).not.toHaveBeenCalled();

      agent.enableTrigger('dt-wake');
      await agent.settle();
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should not evaluate re-enabled triggers while paused', async () => {
      const action = vi.fn();
      agent.addTrigger({ id: 'dt-paused', check: (state) => state.count > 0, actions: [action] });
      await agent.start();
      await agent.pause();
      agent.disableTrigger('dt-paused');
      agent.setState({ count: 1 });
      agent.enableTrigger('dt-paused');
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(action).not.toHaveBeenCalled();

      await agent.resume();
      await agent.settle();
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should throw TRIGGER_NOT_FOUND for unknown id in disableTrigger()', () => {
      expect(() => agent.disableTrigger('no-such-id')).toThrow(AgentError);
      expect(() => agent.disableTrigger('no-such-id')).toThrowError(
        expect.objectContaining({ code: 'TRIGGER_NOT_FOUND' }),
      );
    });

    it('should throw TRIGGER_NOT_FOUND for unknown id in enableTrigger()', () => {
      expect(() => agent.enableTrigger('no-such-id')).toThrow(AgentError);
      expect(() => agent.enableTrigger('no-such-id')).toThrowError(
        expect.objectContaining({ code: 'TRIGGER_NOT_FOUND' }),
      );
    });

    it('isTriggerDisabled() returns true when disabled', () => {
      agent.addTrigger({ id: 'dt-3', check: () => true, actions: [vi.fn()] });
      agent.disableTrigger('dt-3');
      expect(agent.isTriggerDisabled('dt-3')).toBe(true);
    });

    it('isTriggerDisabled() returns false when enabled', () => {
      agent.addTrigger({ id: 'dt-4', check: () => true, actions: [vi.fn()] });
      expect(agent.isTriggerDisabled('dt-4')).toBe(false);
    });

    it('isTriggerDisabled() returns false after re-enabling', () => {
      agent.addTrigger({ id: 'dt-5', check: () => true, actions: [vi.fn()] });
      agent.disableTrigger('dt-5');
      agent.enableTrigger('dt-5');
      expect(agent.isTriggerDisabled('dt-5')).toBe(false);
    });

    it('clearTriggers() also clears the disabled set', () => {
      agent.addTrigger({ id: 'dt-6', check: () => true, actions: [vi.fn()] });
      agent.disableTrigger('dt-6');
      agent.clearTriggers();
      // Re-add with same id to check disabled state was cleared
      agent.addTrigger({ id: 'dt-6', check: () => true, actions: [vi.fn()] });
      expect(agent.isTriggerDisabled('dt-6')).toBe(false);
    });

    it('removeTrigger() also cleans up the disabled set entry', () => {
      agent.addTrigger({ id: 'dt-7', check: () => true, actions: [vi.fn()] });
      agent.disableTrigger('dt-7');
      agent.removeTrigger('dt-7');
      // Re-add — if disabled set was cleaned up, it should not be disabled
      agent.addTrigger({ id: 'dt-7', check: () => true, actions: [vi.fn()] });
      expect(agent.isTriggerDisabled('dt-7')).toBe(false);
    });
  });

  // ─── maxFires ────────────────────────────────────────────────────────────────

  describe('maxFires on Trigger', () => {
    it('should auto-remove the trigger after maxFires fires', async () => {
      // Use explicit setState+settle cycles to trigger each fire separately.
      // Direct state mutation in actions does not call setState(), so each
      // evaluation cycle only fires the trigger once. We drive 3 separate cycles.
      const action = vi.fn();
      agent.addTrigger({
        id: 'mf-1',
        check: (state) => state.count > 0,
        actions: [action],
        maxFires: 3,
        repeat: true,
      });
      await agent.start();
      agent.setState({ count: 1 });
      await agent.settle();
      agent.setState({ count: 2 });
      await agent.settle();
      agent.setState({ count: 3 });
      await agent.settle();
      // Trigger should now be removed (fired 3 times)
      agent.setState({ count: 4 });
      await agent.settle();
      expect(action).toHaveBeenCalledTimes(3);
      expect(agent.getTrigger('mf-1')).toBeUndefined();
    });

    it('should fire exactly maxFires times and stop', async () => {
      const action = vi.fn();
      agent.addTrigger({
        id: 'mf-2',
        check: (state) => state.count > 0,
        actions: [action],
        maxFires: 2,
        repeat: true,
      });
      await agent.start();
      // Fire 1
      agent.setState({ count: 1 });
      await agent.settle();
      // Fire 2 (trigger removed after this)
      agent.setState({ count: 2 });
      await agent.settle();
      // Should NOT fire (trigger is gone)
      agent.setState({ count: 3 });
      await agent.settle();
      expect(action).toHaveBeenCalledTimes(2);
    });

    it('maxFires: 1 fires only once, like repeat: false', async () => {
      const action = vi.fn();
      agent.addTrigger({
        id: 'mf-3',
        check: (state) => state.count > 0,
        actions: [action],
        maxFires: 1,
        repeat: true,
      });
      await agent.start();
      agent.setState({ count: 1 });
      await agent.settle();
      // Change state again — should not fire since trigger was removed
      agent.setState({ count: 2 });
      await agent.settle();
      expect(action).toHaveBeenCalledTimes(1);
      expect(agent.getTrigger('mf-3')).toBeUndefined();
    });

    it('when both repeat: false and maxFires set, trigger is removed after first fire', async () => {
      const action = vi.fn();
      agent.addTrigger({
        id: 'mf-4',
        check: (state) => state.count > 0,
        actions: [action],
        repeat: false,
        maxFires: 5,
      });
      await agent.start();
      agent.setState({ count: 1 });
      await agent.settle();
      agent.setState({ count: 2 });
      await agent.settle();
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('clearTriggers() cleans up fire count tracking', async () => {
      const action = vi.fn();
      agent.addTrigger({
        id: 'mf-5',
        check: (state) => state.count > 0,
        actions: [action],
        maxFires: 5,
        repeat: true,
      });
      await agent.start();
      agent.setState({ count: 1 });
      await agent.settle();
      agent.setState({ count: 2 });
      await agent.settle();
      expect(action).toHaveBeenCalledTimes(2);
      // clearTriggers should remove the trigger and clean up tracking
      agent.clearTriggers();
      expect(agent.getAllTriggers()).toHaveLength(0);
    });
  });

  // ─── priority ────────────────────────────────────────────────────────────────
  //
  // Priority tests use state-mutation chaining: in a single evaluation pass,
  // mutations from one trigger are immediately visible to subsequent trigger
  // checks (same mutable state reference). We exploit this to verify order
  // without relying on external closure variables or timing.

  describe('priority on Trigger', () => {
    it('should evaluate higher priority trigger before lower priority', async () => {
      // High (priority 10) fires first → sets state.flag = 'high'.
      // Low (priority 0) checks flag === 'high' before acting → if high ran first, low runs.
      // Final: flag = 'done' iff evaluation order is high→low.
      interface S {
        go: boolean;
        flag: string;
      }
      const a = new Agent<S>({ initialState: { go: false, flag: '' } });
      a.addTrigger({
        id: 'high',
        priority: 10,
        repeat: false,
        check: (s) => s.go,
        actions: [
          (s) => {
            s.flag = 'high';
          },
        ],
      });
      a.addTrigger({
        id: 'low',
        priority: 0,
        repeat: false,
        check: (s) => s.go && s.flag === 'high',
        actions: [
          (s) => {
            s.flag = 'done';
          },
        ],
      });
      await a.start();
      a.setState({ go: true, flag: '' });
      await a.settle();
      await a.stop();
      // If high fired first, low saw flag='high' in the same pass and ran → 'done'
      expect(a.getState().flag).toBe('done');
    });

    it('should maintain insertion order for triggers with equal priority', async () => {
      // First (priority 5) fires → sets state.step = 'first'.
      // Second (priority 5) checks state.step === 'first' → only runs if first ran first.
      interface S {
        go: boolean;
        step: string;
      }
      const a = new Agent<S>({ initialState: { go: false, step: '' } });
      a.addTrigger({
        id: 'first',
        priority: 5,
        repeat: false,
        check: (s) => s.go,
        actions: [
          (s) => {
            s.step = 'first';
          },
        ],
      });
      a.addTrigger({
        id: 'second',
        priority: 5,
        repeat: false,
        check: (s) => s.go && s.step === 'first',
        actions: [
          (s) => {
            s.step = 'done';
          },
        ],
      });
      await a.start();
      a.setState({ go: true, step: '' });
      await a.settle();
      await a.stop();
      expect(a.getState().step).toBe('done');
    });

    it('should treat undefined priority as 0 (same as explicit 0)', async () => {
      // 'no-priority' (undefined) and 'explicit-zero' (priority: 0) are equal.
      // Insertion order is maintained, so 'no-priority' fires first.
      interface S {
        go: boolean;
        step: string;
      }
      const a = new Agent<S>({ initialState: { go: false, step: '' } });
      a.addTrigger({
        id: 'no-priority',
        repeat: false,
        check: (s) => s.go,
        actions: [
          (s) => {
            s.step = 'no-priority';
          },
        ],
      });
      a.addTrigger({
        id: 'explicit-zero',
        priority: 0,
        repeat: false,
        check: (s) => s.go && s.step === 'no-priority',
        actions: [
          (s) => {
            s.step = 'done';
          },
        ],
      });
      await a.start();
      a.setState({ go: true, step: '' });
      await a.settle();
      await a.stop();
      expect(a.getState().step).toBe('done');
    });

    it('should support negative priority (evaluated after default 0)', async () => {
      // 'normal' (priority 0) fires before 'low-prio' (priority -5).
      interface S {
        go: boolean;
        step: string;
      }
      const a = new Agent<S>({ initialState: { go: false, step: '' } });
      a.addTrigger({
        id: 'normal',
        priority: 0,
        repeat: false,
        check: (s) => s.go,
        actions: [
          (s) => {
            s.step = 'normal';
          },
        ],
      });
      a.addTrigger({
        id: 'low-prio',
        priority: -5,
        repeat: false,
        check: (s) => s.go && s.step === 'normal',
        actions: [
          (s) => {
            s.step = 'done';
          },
        ],
      });
      await a.start();
      a.setState({ go: true, step: '' });
      await a.settle();
      await a.stop();
      expect(a.getState().step).toBe('done');
    });

    it('should include triggers added after the priority order has been cached', async () => {
      interface S {
        go: boolean;
        step: string;
      }
      const a = new Agent<S>({ initialState: { go: false, step: '' } });
      a.addTrigger({
        id: 'low',
        priority: 0,
        repeat: false,
        check: (s) => s.go && s.step === 'high',
        actions: [
          (s) => {
            s.step = 'done';
          },
        ],
      });

      await a.start();
      a.setState({ go: false, step: '' });
      await a.settle();

      a.addTrigger({
        id: 'high',
        priority: 10,
        repeat: false,
        check: (s) => s.go,
        actions: [
          (s) => {
            s.step = 'high';
          },
        ],
      });
      a.setState({ go: true, step: '' });
      await a.settle();
      await a.stop();

      expect(a.getState().step).toBe('done');
    });
  });

  // ─── reset() ─────────────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('should restore state to initialState when running', async () => {
      const a = new Agent({ initialState: { count: 0 } });
      await a.start();
      a.setState({ count: 99 });
      a.reset();
      expect(a.getState().count).toBe(0);
      await a.stop();
    });

    it('should restore state to initialState when stopped', async () => {
      const a = new Agent({ initialState: { count: 0 } });
      await a.start();
      a.setState({ count: 99 });
      await a.stop();
      a.reset();
      expect(a.getState().count).toBe(0);
    });

    it('should restore state to initialState when paused', async () => {
      const a = new Agent({ initialState: { count: 0 } });
      await a.start();
      a.setState({ count: 99 });
      await a.pause();
      a.reset();
      expect(a.getState().count).toBe(0);
      await a.stop();
    });

    it('should keep triggers by default (clearTriggersOnReset = false)', async () => {
      const a = new Agent({ initialState: { count: 0 } });
      a.addTrigger({ id: 'r-1', check: () => true, actions: [vi.fn()] });
      a.reset();
      expect(a.getTrigger('r-1')).toBeDefined();
    });

    it('should clear triggers when clearTriggersOnReset = true', async () => {
      const a = new Agent({ initialState: { count: 0 } });
      a.addTrigger({ id: 'r-2', check: () => true, actions: [vi.fn()] });
      a.reset(true);
      expect(a.getTrigger('r-2')).toBeUndefined();
      expect(a.getAllTriggers()).toHaveLength(0);
    });

    it('should throw AGENT_NOT_INITIALIZED if no initialState was provided', () => {
      const a = new Agent<{ count: number }>();
      expect(() => a.reset()).toThrow(AgentError);
      expect(() => a.reset()).toThrowError(
        expect.objectContaining({ code: 'AGENT_NOT_INITIALIZED' }),
      );
    });

    it('should trigger re-evaluation after reset when running', async () => {
      const action = vi.fn();
      const a = new Agent({ initialState: { count: 5 } });
      a.when((state) => state.count === 5, [action]);
      await a.start();
      a.setState({ count: 99 });
      // Reset back to 5, which should fire the trigger
      a.reset();
      await a.settle();
      await a.stop();
      expect(action).toHaveBeenCalled();
    });
  });

  // ─── off() ───────────────────────────────────────────────────────────────────

  describe('off()', () => {
    it('should remove a trigger by ID', () => {
      agent.addTrigger({ id: 'off-1', check: () => true, actions: [vi.fn()] });
      agent.off('off-1');
      expect(agent.getTrigger('off-1')).toBeUndefined();
    });

    it('should throw AgentError for a non-existent ID (same as removeTrigger)', () => {
      expect(() => agent.off('no-such-id')).toThrow(AgentError);
      expect(() => agent.off('no-such-id')).toThrowError(
        expect.objectContaining({ code: 'TRIGGER_NOT_FOUND' }),
      );
    });

    it('removed trigger should no longer fire', async () => {
      const action = vi.fn();
      const id = agent.when((state) => state.count > 0, [action]);
      agent.off(id);
      await agent.start();
      agent.setState({ count: 1 });
      await agent.settle();
      expect(action).not.toHaveBeenCalled();
    });

    it('should work as shorthand for removeEventTrigger', async () => {
      const action = vi.fn();
      const id = agent.on('my-event', [action]);
      agent.off(id);
      await agent.start();
      agent.emitEvent('my-event');
      await agent.settle();
      expect(action).not.toHaveBeenCalled();
    });
  });
});
