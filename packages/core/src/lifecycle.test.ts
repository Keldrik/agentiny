import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from './index';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Yield to the next event-loop turn so pending promise continuations can run.
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('execution lifecycle regressions', () => {
  const agents: Agent<{ ready: boolean }>[] = [];
  const gates: ReturnType<typeof deferred>[] = [];

  function makeAgent() {
    const agent = new Agent({ initialState: { ready: false } });
    agents.push(agent);
    return agent;
  }

  function gate() {
    const result = deferred();
    gates.push(result);
    return result;
  }

  afterEach(async () => {
    for (const pending of gates.splice(0)) pending.resolve();
    for (const agent of agents.splice(0)) {
      if (agent.isRunning() || agent.isPaused()) await agent.stop();
    }
    vi.useRealTimers();
  });

  it.each(['stop', 'pause'] as const)(
    '%s waits for an active action and skips later actions',
    async (method) => {
      const agent = makeAgent();
      const entered = gate();
      const finish = gate();
      const later = vi.fn();
      let signal: AbortSignal | undefined;
      let finished = false;
      let shutdownFinished = false;
      agent.once(
        (s) => s.ready,
        [
          async (_state, ctx) => {
            signal = ctx?.signal;
            entered.resolve();
            await finish.promise;
            finished = true;
          },
          later,
        ],
      );

      await agent.start();
      agent.updateState({ ready: true });
      await entered.promise;
      const shutdown = agent[method]().then(() => {
        shutdownFinished = true;
      });
      await nextTurn();

      expect(signal?.aborted).toBe(true);
      expect(shutdownFinished).toBe(false);
      expect(finished).toBe(false);
      finish.resolve();
      await shutdown;
      expect(finished).toBe(true);
      expect(later).not.toHaveBeenCalled();
    },
  );

  it.each(['requestStop', 'requestPause'] as const)(
    '%s is safe after an await inside an action',
    async (method) => {
      const agent = makeAgent();
      const requested = gate();
      const finish = gate();
      const later = vi.fn();
      let shutdownFinished = false;
      agent.once(
        (s) => s.ready,
        [
          async () => {
            await Promise.resolve();
            agent[method]();
            requested.resolve();
            await finish.promise;
          },
          later,
        ],
      );

      await agent.start();
      agent.updateState({ ready: true });
      await requested.promise;
      const shutdown = (method === 'requestStop' ? agent.stop() : agent.pause()).then(() => {
        shutdownFinished = true;
      });
      await nextTurn();
      expect(shutdownFinished).toBe(false);
      finish.resolve();
      await shutdown;
      expect(later).not.toHaveBeenCalled();
    },
  );

  it.each(['stop', 'pause'] as const)(
    'restart after %s waits for one-shot bookkeeping',
    async (method) => {
      const agent = makeAgent();
      const entered = gate();
      const finish = gate();
      const action = vi.fn(async () => {
        entered.resolve();
        await finish.promise;
      });
      const id = agent.once((s) => s.ready, [action]);
      await agent.start();
      agent.updateState({ ready: true });
      await entered.promise;

      const shutdown = agent[method]();
      let restarted = false;
      const restart = (method === 'stop' ? agent.start() : agent.resume()).then(() => {
        restarted = true;
      });
      await nextTurn();
      expect(restarted).toBe(false);
      expect(action).toHaveBeenCalledTimes(1);

      finish.resolve();
      await shutdown;
      await restart;
      await agent.settle();
      expect(agent.isRunning()).toBe(true);
      expect(agent.getTrigger(id)).toBeUndefined();
      expect(action).toHaveBeenCalledTimes(1);
    },
  );

  it('only one concurrent start succeeds while a previous run is finishing', async () => {
    const agent = makeAgent();
    const entered = gate();
    const finish = gate();
    agent.once(
      (s) => s.ready,
      [
        async () => {
          entered.resolve();
          await finish.promise;
        },
      ],
    );
    await agent.start();
    agent.updateState({ ready: true });
    await entered.promise;
    const stop = agent.stop();
    const starts = Promise.allSettled([agent.start(), agent.start()]);
    finish.resolve();
    await stop;
    const results = await starts;
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: 'AGENT_ALREADY_RUNNING' }),
      }),
    ]);
    await agent.settle();
  });

  it('does not resume if a pending pause is superseded by stop', async () => {
    const agent = makeAgent();
    const entered = gate();
    const finish = gate();
    agent.once(
      (s) => s.ready,
      [
        async () => {
          entered.resolve();
          await finish.promise;
        },
      ],
    );
    await agent.start();
    agent.updateState({ ready: true });
    await entered.promise;
    const pause = agent.pause();
    const resume = Promise.allSettled([agent.resume()]);
    const stop = agent.stop();
    finish.resolve();
    await Promise.all([pause, stop]);
    expect(await resume).toEqual([
      expect.objectContaining({
        status: 'rejected',
        reason: expect.objectContaining({ code: 'AGENT_NOT_PAUSED' }),
      }),
    ]);
    expect(agent.getStatus()).toBe('stopped');
  });

  it('stopping during an async check prevents conditions and actions from starting', async () => {
    const agent = makeAgent();
    const entered = gate();
    const finish = gate();
    const condition = vi.fn(() => true);
    const action = vi.fn();
    agent.once(
      async (s) => {
        if (!s.ready) return false;
        entered.resolve();
        await finish.promise;
        return true;
      },
      [condition],
      [action],
    );
    await agent.start();
    agent.updateState({ ready: true });
    await entered.promise;
    const stop = agent.stop();
    finish.resolve();
    await stop;
    expect(condition).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it.each(['action', 'check', 'condition', 'delayed action'] as const)(
    'settle waits for a pending %s after the agent was already quiet',
    async (work) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const agent = makeAgent();
      const entered = gate();
      const finish = gate();
      let workFinished = false;
      const wait = async () => {
        entered.resolve();
        await finish.promise;
        workFinished = true;
      };
      agent.addTrigger({
        id: 'work',
        check: async (s) => {
          if (s.ready && work === 'check') await wait();
          return s.ready;
        },
        conditions: [
          async () => {
            if (work === 'condition') await wait();
            return true;
          },
        ],
        actions: [
          async () => {
            if (work === 'action' || work === 'delayed action') await wait();
          },
        ],
        delay: work === 'delayed action' ? 50 : undefined,
        repeat: false,
      });
      await agent.start();
      const initiallySettled = agent.settle();
      await vi.advanceTimersByTimeAsync(30);
      await initiallySettled;

      agent.updateState({ ready: true });
      await vi.advanceTimersByTimeAsync(work === 'delayed action' ? 50 : 0);
      await entered.promise;
      let settled = false;
      const pending = agent.settle().then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(30);
      expect(settled).toBe(false);
      expect(workFinished).toBe(false);

      finish.resolve();
      await vi.advanceTimersByTimeAsync(30);
      await pending;
      expect(workFinished).toBe(true);
      expect(settled).toBe(true);
    },
  );

  it('settle times out while an active action remains blocked', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const agent = makeAgent();
    const entered = gate();
    const finish = gate();
    agent.once(
      (s) => s.ready,
      [
        async () => {
          entered.resolve();
          await finish.promise;
        },
      ],
    );
    await agent.start();
    const initiallySettled = agent.settle();
    await vi.advanceTimersByTimeAsync(30);
    await initiallySettled;
    agent.updateState({ ready: true });
    await vi.advanceTimersByTimeAsync(0);
    await entered.promise;
    const pending = Promise.allSettled([agent.settle(2, 50)]);
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toEqual([
      expect.objectContaining({
        status: 'rejected',
        reason: expect.objectContaining({ code: 'SETTLE_TIMEOUT' }),
      }),
    ]);
  });
});
