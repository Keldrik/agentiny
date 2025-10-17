# @agentiny/core

Lightweight TypeScript agent framework with zero dependencies. Build reactive agents using trigger-condition-action flows.

## Features

- **Zero Dependencies** - Minimal footprint, no runtime dependencies
- **Type-Safe** - Full TypeScript support with strict mode
- **Event-Driven** - Reactive trigger system with state management
- **Flexible** - Support for repeating triggers, one-time triggers, and event-based triggers
- **Async/Await** - Full async support for conditions and actions
- **Small Bundle** - Less than 5KB minified + gzipped

## Installation

```bash
npm install @agentiny/core
```

Or with other package managers:

```bash
# pnpm
pnpm add @agentiny/core

# yarn
yarn add @agentiny/core

# bun
bun add @agentiny/core
```

## Quick Start

### Basic Example

```typescript
import { Agent } from '@agentiny/core';

// Create an agent with initial state
const agent = new Agent({
  initialState: { count: 0, message: '' },
});

// Add a trigger using the low-level API
agent.addTrigger({
  id: 'counter-trigger',
  check: (state) => state.count > 5,
  conditions: [(state) => state.count % 2 === 0],
  actions: [
    (state) => {
      state.message = `Count is ${state.count}`;
      console.log(state.message);
    },
  ],
  repeat: true,
});

// Start the agent
await agent.start();

// Update state - triggers will be evaluated
agent.setState({ count: 6 });

// Stop the agent
await agent.stop();
```

### Using Convenience Methods

The library provides sugar methods for common patterns:

#### `when()` - State-based repeating trigger

```typescript
const agent = new Agent({ initialState: { temperature: 0 } });

// Repeat when temperature exceeds 30
const triggerId = agent.when(
  (state) => state.temperature > 30,
  [(state) => console.log('Temperature alarm:', state.temperature)],
);

await agent.start();
agent.setState({ temperature: 35 });
```

#### `once()` - One-time trigger

```typescript
const agent = new Agent({ initialState: { initialized: false } });

// Fire only once when initialized
agent.once((state) => state.initialized === true, [(state) => console.log('System ready!')]);

await agent.start();
agent.setState({ initialized: true });
```

#### `on()` - Event-based trigger

```typescript
const agent = new Agent({ initialState: {} });

// Listen for specific events
agent.on('user-login', [(state) => console.log('User logged in!')]);

await agent.start();
agent.emitEvent('user-login');
```

## API Reference

### Agent

The main class for creating and managing agents.

#### Constructor

```typescript
new Agent<TState>(config?: AgentConfig<TState>)
```

**Options:**

- `initialState?: TState` - Initial state object
- `triggers?: Trigger<TState>[]` - Initial triggers to register
- `onError?: (error: Error) => void` - Error handler callback

#### Methods

##### State Management

- `getState(): TState` - Get current state
- `setState(newState: TState): void` - Update state
- `subscribe(callback: (state: TState) => void): () => void` - Subscribe to state changes

##### Trigger Management

- `addTrigger(trigger: Trigger<TState>): void` - Register a trigger
- `getTrigger(id: string): Trigger<TState> | undefined` - Get trigger by ID
- `getAllTriggers(): Trigger<TState>[]` - Get all registered triggers
- `removeTrigger(id: string): void` - Remove a trigger
- `clearTriggers(): void` - Remove all triggers

##### Agent Lifecycle

- `start(): Promise<void>` - Start the agent
- `stop(): Promise<void>` - Stop the agent
- `isRunning(): boolean` - Check if agent is running
- `getStatus(): AgentStatus` - Get current status

##### Convenience Methods

- `when(check, actions): string` - Create a repeating state-based trigger
- `once(check, actions): string` - Create a one-time state-based trigger
- `on(event, actions): string` - Create an event-based trigger
- `emitEvent(event: string): void` - Emit an event

### State

Reactive state container with subscription support.

```typescript
const state = new State<TState>(initialValue);

state.get(); // Get current value
state.set(newValue); // Update value
state.subscribe(callback); // Subscribe to changes
```

### Types

#### TriggerFn

```typescript
type TriggerFn<TState> = (state: TState) => boolean | Promise<boolean>;
```

Function that checks if a trigger should fire.

#### ConditionFn

```typescript
type ConditionFn<TState> = (state: TState) => boolean | Promise<boolean>;
```

Function that checks if a condition is met.

#### ActionFn

```typescript
type ActionFn<TState> = (state: TState) => void | Promise<void>;
```

Function that performs an action.

#### Trigger

```typescript
interface Trigger<TState> {
  id: string;
  check: TriggerFn<TState>;
  conditions?: readonly ConditionFn<TState>[];
  actions: readonly ActionFn<TState>[];
  repeat?: boolean;
  delay?: number;
}
```

Complete trigger definition.

#### AgentConfig

```typescript
interface AgentConfig<TState> {
  initialState?: TState;
  triggers?: Trigger<TState>[];
  onError?: (error: Error) => void;
}
```

Configuration for creating an agent.

#### AgentStatus

```typescript
enum AgentStatus {
  Idle = 'idle',
  Running = 'running',
  Stopped = 'stopped',
}
```

Agent execution status.

### AgentError

Custom error class for agent-related errors.

```typescript
class AgentError extends Error {
  code: string;
  context?: unknown;
}
```

## Examples

### Real-time Counter

```typescript
import { Agent } from '@agentiny/core';

interface CounterState {
  count: number;
  total: number;
}

const agent = new Agent<CounterState>({
  initialState: { count: 0, total: 0 },
});

// Increment total every time count increases
agent.when(
  (state) => state.count > state.total,
  [
    (state) => {
      state.total = state.count;
    },
  ],
);

// Log when count reaches 10
agent.once((state) => state.count >= 10, [(state) => console.log('Reached 10!')]);

await agent.start();

for (let i = 1; i <= 15; i++) {
  agent.setState({ count: i, total: 0 });
  await new Promise((r) => setTimeout(r, 100));
}

await agent.stop();
```

### Event-Driven User Flow

```typescript
import { Agent } from '@agentiny/core';

interface AppState {
  user: string | null;
  message: string;
}

const app = new Agent<AppState>({
  initialState: { user: null, message: '' },
});

// Listen for login event
app.on('login', [
  (state) => {
    state.message = `Welcome ${state.user}!`;
    console.log(state.message);
  },
]);

// Listen for logout event with condition
app.on(
  'logout',
  [(state) => state.user !== null], // condition
  [
    (state) => {
      state.message = `Goodbye ${state.user}!`;
      state.user = null;
      console.log(state.message);
    },
  ],
);

await app.start();

app.setState({ user: 'Alice' });
app.emitEvent('login');

app.emitEvent('logout');
```

### Conditional Execution with Delay

```typescript
import { Agent } from '@agentiny/core';

const agent = new Agent({ initialState: { critical: false } });

agent.addTrigger({
  id: 'alert-trigger',
  check: (state) => state.critical === true,
  conditions: [(state) => state.critical],
  actions: [(state) => console.log('CRITICAL ALERT!')],
  delay: 5000, // Wait 5 seconds before executing
  repeat: false, // Execute only once
});

await agent.start();
agent.setState({ critical: true });
// Will log "CRITICAL ALERT!" after 5 seconds, then remove trigger
```

## Error Handling

Errors during action execution are caught and passed to the error handler:

```typescript
const agent = new Agent({
  initialState: { count: 0 },
  onError: (error) => {
    console.error('Agent error:', error.message);
  },
});

agent.addTrigger({
  id: 'failing-trigger',
  check: (state) => state.count > 0,
  actions: [
    (state) => {
      throw new Error('Something went wrong!');
    },
  ],
  repeat: true,
});

await agent.start();
agent.setState({ count: 1 }); // Error will be logged
```

## Performance

- **Lightweight**: Less than 5KB minified + gzipped
- **No dependencies**: Pure TypeScript with zero runtime dependencies
- **Efficient**: Minimal polling overhead with configurable intervals
- **Memory-safe**: Proper cleanup of triggers and subscriptions

## TypeScript Support

Full TypeScript support with strict mode enabled:

```typescript
// Fully typed state
interface AppState {
  user: { id: string; name: string } | null;
  isLoading: boolean;
  errors: string[];
}

const agent = new Agent<AppState>({
  initialState: {
    user: null,
    isLoading: false,
    errors: [],
  },
});

// Type-safe access in all callbacks
agent.when(
  (state) => state.user !== null,
  [
    (state) => {
      console.log(state.user.name); // Fully typed!
    },
  ],
);
```

## License

MIT

## Contributing

Contributions welcome! Please ensure all tests pass and maintain 100% coverage:

```bash
npm run typecheck  # Type checking
npm run lint       # ESLint
npm run format     # Prettier
npm run test       # Vitest with coverage
```

## See Also

- [@agentiny/utils](../utils) - Utility functions and helpers
- [@agentiny/openai](../openai) - OpenAI integration
- [@agentiny/anthropic](../anthropic) - Anthropic SDK integration
