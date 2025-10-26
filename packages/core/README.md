# @agentiny/core

**Build autonomous reactive agents with TypeScript** - A lightweight, zero-dependency framework for creating intelligent systems using trigger-condition-action flows. Perfect for automation, workflow orchestration, state machines, and reactive application logic.

## What is @agentiny/core?

`@agentiny/core` is a TypeScript agent framework that enables you to build reactive, event-driven systems with minimal overhead. It provides a clean, composable API for defining **triggers** (when to act), **conditions** (validation logic), and **actions** (what to do) - all with full async/await support.

### Use Cases

- **Workflow Automation** - Automate multi-step processes with conditional logic
- **Event-Driven Systems** - Build responsive applications that react to state changes and events
- **State Machines** - Implement complex state management with clear trigger-condition-action patterns
- **Reactive Agents** - Create autonomous agents that monitor conditions and take actions
- **Business Logic Orchestration** - Coordinate complex business rules and workflows
- **Real-time Monitoring** - Build monitoring systems that respond to state changes

## Features

- **Zero Dependencies** - Minimal footprint with no runtime dependencies
- **Type-Safe** - Full TypeScript support with strict mode enabled
- **Event-Driven Architecture** - Reactive trigger system with state management
- **Three Trigger Types** - Repeating state-based triggers, one-time triggers, and event-based triggers
- **Async/Await Support** - Full async support for all checks, conditions, and actions
- **Cascading Action Support** - Wait for all cascading trigger-action flows to complete with `settle()`
- **Small Bundle Size** - Less than 5KB minified + gzipped
- **Performance Optimized** - Smart state change tracking minimizes unnecessary evaluations
- **Well-Tested** - 152+ comprehensive tests with vitest

## Quick Navigation

- [Installation](#installation) - Get started in seconds
- [Quick Start](#quick-start) - See working examples
- [API Reference](#api-reference) - Complete method documentation
- [settle()](#settle---waiting-for-cascading-actions) - Wait for cascading actions
- [Best Practices](#best-practices) - Design patterns and tips
- [Performance](#performance--optimization) - How it's optimized
- [Examples](#examples) - Real-world use cases

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
- `settle(quietCycles?: number, timeout?: number): Promise<void>` - Wait for all cascading actions to complete

##### Convenience Methods

- `when(check, [actions] | [conditions, actions]): string` - Create a repeating state-based trigger
- `once(check, [actions] | [conditions, actions]): string` - Create a one-time state-based trigger
- `on(event, [actions] | [conditions, actions], repeat?): string` - Create an event-based trigger
- `emitEvent(event: string): void` - Emit an event

##### Event Trigger Management

- `removeEventTrigger(event: string, triggerId: string): void` - Remove a specific event-based trigger
- `removeAllEventTriggersForEvent(event: string): void` - Remove all triggers listening to an event
- `getEventTriggersForEvent(event: string): Trigger<TState>[]` - Get all triggers for a specific event
- `getEventTriggers(): Map<string, Trigger<TState>[]>` - Get all event-based triggers organized by event

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

## settle() - Waiting for Cascading Actions

The `settle()` method allows you to wait for all cascading trigger-action flows to complete. This is essential when one action's state changes trigger additional actions, creating a chain of effects.

### Why Use settle()?

When you update the agent's state, it might trigger multiple cascading actions:

```
setState(state1)
  ↓
Trigger 1 fires, executes action → setState(state2)
  ↓
Trigger 2 fires, executes action → setState(state3)
  ↓
Trigger 3 fires, executes action
  ↓
No more state changes (settled)
```

Without `settle()`, you won't know when all cascading effects are complete. `settle()` solves this elegantly by detecting when the agent has been quiet for N consecutive polling cycles.

### Method Signature

```typescript
settle(quietCycles = 2, timeout = 10000): Promise<void>
```

**Parameters:**
- `quietCycles` (optional, default: 2) - Number of consecutive polling cycles with no state changes required before settling (each cycle is ~10ms, so default is ~20ms)
- `timeout` (optional, default: 10000) - Maximum time to wait in milliseconds before rejecting with a timeout error

**Returns:** Promise that resolves when the agent is quiet, or rejects on timeout/error

**Throws:**
- `AgentError` with code `'AGENT_NOT_RUNNING'` if agent is not running
- `AgentError` with code `'INVALID_ARGUMENT'` if quietCycles <= 0
- `AgentError` with code `'SETTLE_TIMEOUT'` if timeout is exceeded
- `AgentError` with code `'AGENT_STOPPED'` if agent stops while waiting

### Examples

#### Basic Usage

```typescript
const agent = new Agent({ initialState: { count: 1 } });

agent.when((state) => state.count < 3, [
  (state) => { state.count++; }
]);

await agent.start();
agent.setState({ count: 1 });

// Wait for all cascading actions (cascades: 1 → 2 → 3)
await agent.settle();

console.log(agent.getState().count); // 3
await agent.stop();
```

#### Multi-Step Workflow

```typescript
interface WorkflowState {
  stage: 'init' | 'processing' | 'validating' | 'complete';
}

const agent = new Agent<WorkflowState>({
  initialState: { stage: 'init' }
});

// Stage 1: init → processing
agent.when((state) => state.stage === 'init', [
  (state) => { state.stage = 'processing'; console.log('Processing...'); }
]);

// Stage 2: processing → validating
agent.when((state) => state.stage === 'processing', [
  (state) => { state.stage = 'validating'; console.log('Validating...'); }
]);

// Stage 3: validating → complete
agent.when((state) => state.stage === 'validating', [
  (state) => { state.stage = 'complete'; console.log('Complete!'); }
]);

await agent.start();
agent.setState({ stage: 'init' });

// Wait for all 3 cascading actions to complete
await agent.settle();
console.log(agent.getState()); // { stage: 'complete' }
```

#### Custom Quiet Cycles

```typescript
// Require 5 quiet cycles (~50ms) instead of default 2
await agent.settle(5);

// Custom timeout (5 seconds instead of 10)
await agent.settle(2, 5000);
```

#### Error Handling

```typescript
try {
  // Try to settle with impossible requirements
  await agent.settle(100, 50); // 100 cycles in 50ms
} catch (error) {
  if (error instanceof AgentError) {
    if (error.code === 'SETTLE_TIMEOUT') {
      console.log('Timed out waiting for agent to settle');
      console.log('Quiet cycles so far:', error.context.currentQuietCycles);
    }
  }
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

### Cascading Actions with settle()

```typescript
import { Agent } from '@agentiny/core';

interface ProcessingState {
  stage: 'input' | 'processing' | 'validating' | 'output';
  data: string;
}

const agent = new Agent<ProcessingState>({
  initialState: { stage: 'input', data: '' },
});

// Input → Processing
agent.when((state) => state.stage === 'input' && state.data.length > 0, [
  (state) => {
    console.log('Processing data...');
    state.stage = 'processing';
  },
]);

// Processing → Validating
agent.when((state) => state.stage === 'processing', [
  (state) => {
    console.log('Validating data...');
    state.stage = 'validating';
  },
]);

// Validating → Output
agent.when((state) => state.stage === 'validating', [
  (state) => {
    console.log('Data ready!');
    state.stage = 'output';
  },
]);

await agent.start();
agent.setState({ stage: 'input', data: 'important data' });

// Wait for all cascading actions to complete
await agent.settle();

console.log(agent.getState()); // { stage: 'output', data: 'important data' }
await agent.stop();
```

## Performance & Optimization

@agentiny/core is built with performance in mind:

### Smart State Change Tracking

The agent uses intelligent state change detection to minimize unnecessary trigger evaluations. Triggers are only checked when:

- State actually changes (via `setState()`)
- An event is emitted (via `emitEvent()`)
- The agent starts

This means idle agents with stable state consume minimal CPU resources.

### Memory Efficiency

- Automatic cleanup of subscriptions and triggers
- No memory leaks from dangling event listeners
- Proper error handling prevents memory accumulation

### Scalability

Tested with 100+ triggers with no performance degradation. The polling architecture ensures consistent behavior regardless of trigger count.

## Testing

The package includes 152+ comprehensive tests covering:

- All agent lifecycle methods
- State management and subscriptions
- All trigger types (state-based, one-time, event-based)
- Async operations and error handling
- Edge cases and complex scenarios

Run tests with:

```bash
npm run test          # Watch mode
npm run test:run      # Single run
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

## Best Practices

### 1. Handle Errors Gracefully

Always provide an error handler to catch and log errors:

```typescript
const agent = new Agent({
  initialState: {},
  onError: (error) => {
    console.error('Agent error:', error.message);
    // Send to logging service
  },
});
```

### 2. Clean Up Event Triggers

Remove event triggers when no longer needed:

```typescript
const id = agent.on('event', [action]);
// Later...
agent.removeEventTrigger('event', id);

// Or remove all for an event:
agent.removeAllEventTriggersForEvent('event');
```

### 3. Use Type-Safe State

Define your state interface for better TypeScript support:

```typescript
interface AppState {
  user: User | null;
  loading: boolean;
  errors: string[];
}

const agent = new Agent<AppState>({
  initialState: { user: null, loading: false, errors: [] },
});
```

### 4. Leverage Conditions for Complex Logic

Use conditions to add validation before actions:

```typescript
agent.when(
  (state) => state.user !== null,
  [
    (state) => state.user.role === 'admin', // condition
  ],
  [(state) => console.log('Admin action allowed')],
);
```

### 5. Use One-Time Triggers for Initialization

Perfect for one-time setup tasks:

```typescript
agent.once((state) => state.initialized === true, [(state) => console.log('System initialized')]);
```

### 6. Use settle() for Cascading Actions

When you have triggers that cascade (actions that trigger more actions), use `settle()` to wait for all effects to complete:

```typescript
// Trigger a chain of actions
agent.setState({ stage: 'start' });

// Wait for all cascading actions to finish
await agent.settle();

// Now safe to proceed knowing all effects are done
console.log('All cascading actions complete!');
```

## Performance Characteristics

- **Lightweight**: Less than 5KB minified + gzipped
- **No dependencies**: Pure TypeScript with zero runtime dependencies
- **Efficient**: Smart state change tracking eliminates unnecessary evaluations
- **Memory-safe**: Proper cleanup of triggers and subscriptions
- **Scalable**: Handles 100+ triggers efficiently

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

## AI Agent Integration

While `@agentiny/core` provides the foundational framework, it integrates seamlessly with AI providers through companion packages:

- **[@agentiny/openai](../openai)** - Create AI-powered actions with OpenAI
- **[@agentiny/anthropic](../anthropic)** - Integrate Anthropic's Claude API
- **[@agentiny/gemini](../gemini)** - Use Google Gemini for AI actions

These adapters allow you to build intelligent agents that leverage AI models as part of their trigger-condition-action flows.

## Ecosystem

The agentiny framework consists of:

- **@agentiny/core** - Core agent framework (this package)
- **@agentiny/utils** - Utility wrappers (retry, timeout, validation)
- **@agentiny/openai** - OpenAI integration
- **@agentiny/anthropic** - Anthropic SDK integration
- **@agentiny/gemini** - Google Gemini integration

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT

## See Also

- [@agentiny/utils](../utils) - Utility functions and helpers
- [@agentiny/openai](../openai) - OpenAI integration
- [@agentiny/anthropic](../anthropic) - Anthropic SDK integration
- [@agentiny/gemini](../gemini) - Google Gemini integration
