# @agentiny/core

Small TypeScript primitives for building reactive agents with state, triggers,
conditions, and actions.

Use it when you want simple in-process automation:

- Watch state and run actions when checks pass.
- Chain actions by updating state.
- Emit named events and react to them.
- Wait for cascades to finish with `settle()`.

## Install

```bash
npm install @agentiny/core
```

## Quick Start

```typescript
import { Agent } from '@agentiny/core';

type State = {
  count: number;
  message?: string;
};

const agent = new Agent<State>({
  initialState: { count: 0 },
});

agent.when(
  (state) => state.count >= 3,
  [
    (state) => {
      state.message = 'threshold reached';
    },
  ],
);

await agent.start();
agent.updateState({ count: 3 });
await agent.settle();

console.log(agent.getState().message); // "threshold reached"
await agent.stop();
```

## How It Works

An agent owns one state value and a set of triggers.

A trigger has:

- `check`: decides if the trigger should run.
- `conditions`: optional extra guards.
- `actions`: functions that run when the check and conditions pass.

Checks, conditions, and actions can be sync or async.

```typescript
agent.addTrigger({
  id: 'send-alert',
  check: (state) => state.count > 10,
  conditions: [(state) => state.message !== 'sent'],
  actions: [
    async (state) => {
      await sendAlert();
      state.message = 'sent';
    },
  ],
  repeat: true,
});
```

Actions receive the live state object. If you mutate it directly, later triggers
in the same evaluation pass can see that mutation. If you need to schedule a new
evaluation pass, call `setState()` or `updateState()`.

## Common Patterns

### Partial State Updates

Use `updateState()` for object state.

```typescript
agent.updateState({ count: agent.getState().count + 1 });
```

Use `setState()` when replacing the whole state value.

```typescript
agent.setState({ count: 0, message: undefined });
```

### One-Time Triggers

```typescript
agent.once(
  (state) => state.count > 0,
  [(state) => console.log('first positive count', state.count)],
);
```

### Event Triggers

```typescript
agent.on('saved', [
  () => {
    console.log('saved');
  },
]);

agent.emitEvent('saved');
await agent.settle();
```

### Time-Based Triggers

`every(interval, ...)` fires repeatedly on a fixed interval. The interval is
either milliseconds or a duration string (`ms`, `s`, `m`, `h`).
Timers start when the agent is running. If a schedule is registered while idle
or stopped, it begins on the next `start()`.

```typescript
agent.every('2h', [refreshFeed]);
agent.every(30_000, [hasPendingWork], [flushQueue]);
agent.every('5s', [poll], { immediate: true }); // also fires on the first cycle
```

`at(time, ...)` fires at a wall-clock time of day in the host's local timezone.
Accepts `"HH:MM"` (24h) or `"H:MMam"` / `"H:MMpm"` (12h, case-insensitive).
Repeats daily by default; pass `{ once: true }` to fire only on the next
occurrence and self-remove.

```typescript
agent.at('21:30', [sendDailyReport]);
agent.at('9:30am', [isWeekday], [sendStandupReminder]);
agent.at('00:00', [resetCounters], { once: true });
```

Both methods accept the optional middle conditions array, return the trigger
id, and honor `priority` / `maxFires` via the options bag. They throw an
`AgentError` with code `INVALID_TIME` or `INVALID_INTERVAL` on malformed
input.

### Pause And Resume

Pause keeps state and triggers, but stops trigger evaluation.

```typescript
await agent.start();
await agent.pause();

agent.updateState({ count: 10 }); // no triggers run while paused

await agent.resume(); // triggers are evaluated again
await agent.settle();
```

Call `resume()` to leave the paused state. Calling `start()` while paused throws.

### Temporarily Disable A Trigger

```typescript
const id = agent.when((state) => state.count > 5, [handleCount]);

agent.disableTrigger(id);
agent.enableTrigger(id);
```

When a trigger is re-enabled while the agent is running, it is evaluated again
without requiring another state update.

### Trigger Priority

Higher priority triggers run first. Equal priority triggers keep insertion order.

```typescript
agent.addTrigger({
  id: 'normalize',
  priority: 100,
  check: (state) => state.count < 0,
  actions: [
    (state) => {
      state.count = 0;
    },
  ],
});
```

### Auto-Remove After N Fires

```typescript
agent.addTrigger({
  id: 'show-hint',
  check: (state) => state.count > 0,
  actions: [showHint],
  maxFires: 3,
});
```

`maxFires` must be a positive integer.

### Reset State

```typescript
agent.reset(); // restore initialState, keep triggers
agent.reset(true); // restore initialState, clear triggers
```

`reset()` restores the original `initialState` reference. It does not deep clone
the initial state.

## API

### Agent

```typescript
new Agent<TState>(config?: AgentConfig<TState>)
```

### State

- `getState(): TState`
- `setState(newState: TState): void`
- `updateState(partial: Partial<TState>): void`
- `subscribe(callback): () => void`

### Lifecycle

- `start(): Promise<void>`
- `pause(): Promise<void>`
- `resume(): Promise<void>`
- `stop(): Promise<void>`
- `reset(clearTriggers?: boolean): void`
- `isRunning(): boolean`
- `isPaused(): boolean`
- `getStatus(): AgentStatus`
- `settle(quietCycles?: number, timeout?: number): Promise<void>`

Valid lifecycle transitions:

```text
idle -> running
running -> paused
paused -> running
running -> stopped
paused -> stopped
stopped -> running
```

### Triggers

- `addTrigger(trigger): string`
- `getTrigger(id): Trigger | undefined`
- `getAllTriggers(): Trigger[]`
- `removeTrigger(id): void`
- `clearTriggers(): void`
- `disableTrigger(id): void`
- `enableTrigger(id): void`
- `isTriggerDisabled(id): boolean`
- `off(id): void`

### Convenience Methods

- `when(check, actions): string`
- `when(check, conditions, actions): string`
- `once(check, actions): string`
- `once(check, conditions, actions): string`
- `on(event, actions, repeat?): string`
- `on(event, conditions, actions, repeat?): string`
- `at(time, actions, options?): string`
- `at(time, conditions, actions, options?): string`
- `every(interval, actions, options?): string`
- `every(interval, conditions, actions, options?): string`
- `emitEvent(event): void`
- `removeEventTrigger(event, id): void`
- `removeAllEventTriggersForEvent(event): void`
- `getEventTriggersForEvent(event): Trigger[]`
- `getEventTriggers(): Map<string, Trigger[]>`

## Types

```typescript
type TriggerFn<TState> = (state: TState) => boolean | Promise<boolean>;
type ConditionFn<TState> = (state: TState) => boolean | Promise<boolean>;
type ActionFn<TState> = (state: TState) => void | Promise<void>;

interface AgentConfig<TState> {
  initialState?: TState;
  triggers?: Trigger<TState>[];
  onError?: (error: Error) => void;
  idleTimeout?: number;
  logger?: (error: unknown) => void;
}

interface Trigger<TState> {
  id: string;
  check: TriggerFn<TState>;
  conditions?: readonly ConditionFn<TState>[];
  actions: readonly ActionFn<TState>[];
  repeat?: boolean;
  delay?: number;
  maxFires?: number;
  priority?: number;
}

enum AgentStatus {
  Idle = 'idle',
  Running = 'running',
  Paused = 'paused',
  Stopped = 'stopped',
}
```

## Error Handling

Agent lifecycle and trigger-management errors throw `AgentError`.

```typescript
try {
  await agent.start();
  await agent.start();
} catch (error) {
  if (error instanceof AgentError) {
    console.error(error.code, error.context);
  }
}
```

Use `onError` for errors raised while evaluating checks, conditions, or actions.
Action errors are collected and reported, but later actions still run.

```typescript
const agent = new Agent({
  initialState: { count: 0 },
  onError: (error) => {
    console.error(error);
  },
});
```

## Notes

- `updateState()` is a shallow merge for object state.
- `settle()` requires the agent to be running.
- Disabled triggers remain registered and can be re-enabled.
- Event triggers created with `on()` are normal triggers and can be removed with `off()`.
- Scheduled triggers registered with `at()` and `every()` keep their trigger IDs across stop/start.
- While paused, scheduled timers may continue ticking, but actions do not run until resume.
- `idleTimeout` controls how often the loop wakes when there is no work. The default is `100ms`.

## License

MIT
