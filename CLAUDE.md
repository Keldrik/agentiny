# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**agenTiny** is a lightweight TypeScript agent framework for building reactive agents using trigger-condition-action flows. It features zero runtime dependencies, full async/await support, and less than 5KB minified + gzipped.

### Architecture

The project is organized as a monorepo with 5 packages:

- **@agentiny/core** - The core framework with the `Agent` class, state management, and trigger system
- **@agentiny/utils** - Utility wrappers (retry, timeout, validation) for common patterns
- **@agentiny/anthropic** - Anthropic SDK adapter for creating AI-powered actions
- **@agentiny/openai** - OpenAI SDK adapter for creating AI-powered actions
- **@agentiny/gemini** - Google Gemini SDK adapter for creating AI-powered actions

### Core Concepts

**Agent**: The main class that orchestrates trigger-condition-action flows. It maintains a state object and continuously evaluates registered triggers.

**Trigger**: A configuration that defines when to execute actions:
- `id` - Unique identifier
- `check` - Function returning boolean to determine if trigger should fire
- `conditions` - Optional array of functions that must all return true
- `actions` - Array of functions to execute when trigger fires and conditions pass
- `repeat` - Whether trigger should repeat (default: true) or fire once
- `delay` - Optional millisecond delay before executing actions

**State**: Reactive state container with subscription support. When state is updated, the agent re-evaluates all triggers.

**Convenience Methods**:
- `agent.when(check, actions)` - Repeating state-based trigger
- `agent.once(check, actions)` - One-time state-based trigger
- `agent.on(event, actions)` - Event-based trigger (use `agent.emitEvent(eventName)` to trigger)

All three methods support optional conditions as a middle parameter.

## Development Commands

### Workspaces
The project uses npm workspaces. Commands run at root affect all packages.

### Build
```bash
npm run build          # Build all packages
npm run build -w @agentiny/core  # Build specific package
```

### Type Checking
```bash
npm run typecheck      # Type check all packages
npm run typecheck -w @agentiny/core  # Type check specific package
```

### Linting & Formatting
```bash
npm run lint           # Run ESLint on all source files (src/**/*.ts)
npm run format         # Check formatting with Prettier
npm run format:write   # Auto-fix formatting with Prettier
```

### Full validation (use before commits)
```bash
npm run typecheck && npm run lint && npm run format:write && npm run build
```

## Code Architecture Details

### State Management (packages/core/src/state.ts)

The `State` class provides a simple reactive container:
- `get()` - Retrieves current state
- `set(newValue)` - Updates state and notifies subscribers
- `subscribe(callback)` - Returns unsubscribe function

State is immutable from the user's perspective (though actions can mutate it), and changes trigger re-evaluation of all triggers.

### Trigger Execution Loop (packages/core/src/agent.ts)

The agent runs a continuous polling loop (10ms intervals) while running:
1. Iterates through all registered triggers
2. Calls trigger's `check(state)` function
3. If check passes, evaluates all `conditions` (all must pass)
4. If conditions pass, applies `delay` if configured
5. Executes all `actions` sequentially
6. For one-time triggers (`repeat: false`), automatically removes the trigger
7. Errors during action execution are passed to the `onError` callback

### Error Handling

Use the `onError` callback in `AgentConfig` to handle errors:
```typescript
const agent = new Agent({
  initialState: {},
  onError: (error) => {
    console.error('Agent error:', error.message);
    // Custom error handling
  }
});
```

Errors thrown in check functions, conditions, or actions are caught and passed to this callback. The agent continues running.

### Package Structure

Each adapter package (anthropic, openai, gemini) exports a factory function that creates an action:
```typescript
const action = createAnthropicAction(config, options);
// Returns an ActionFn<TState> that can be used in triggers
```

These allow AI models to participate in trigger-action flows by generating responses based on state.

## TypeScript Configuration

- **Target**: ES2020
- **Strict Mode**: Fully enabled (strictNullChecks, noImplicitAny, etc.)
- **Module Resolution**: Node10
- **Path Aliases**: All packages are aliased (@agentiny/*)

All packages have `strict: true` in their tsconfig.json. Maintain this strictness when modifying code.

## ESLint Configuration

Rules enforced:
- TypeScript recommended rules
- Array types must use `Type[]` syntax (not `Array<Type>`)
- Generic constructors must use explicit type syntax

The config ignores dist/ and node_modules/.

## Common Development Patterns

### Adding a New Trigger
```typescript
agent.addTrigger({
  id: 'unique-id',
  check: (state) => someCondition(state),
  conditions: [optionalConditionFn],
  actions: [action1, action2],
  repeat: true,
  delay: 1000  // optional
});
```

### State Subscriptions
```typescript
const unsubscribe = agent.subscribe((newState) => {
  console.log('State changed:', newState);
});
// Later:
unsubscribe();
```

### Async Triggers
All trigger checks, conditions, and actions support async:
```typescript
agent.when(
  async (state) => await someAsyncCheck(state),
  [async (state) => await someAsyncAction(state)]
);
```

### Testing Triggers
When testing, remember:
- Agent must be started with `await agent.start()` for triggers to evaluate
- After updating state with `setState()`, triggers are evaluated on next poll cycle (within 10ms)
- Use `await agent.stop()` to clean up
- State subscriptions fire immediately but triggers have polling latency

## Key Files by Purpose

- **packages/core/src/agent.ts** - Main Agent class and execution loop
- **packages/core/src/types.ts** - TypeScript interfaces for triggers, conditions, actions
- **packages/core/src/state.ts** - Reactive state container
- **packages/core/src/actions.ts** - executeActions helper
- **packages/core/src/conditions.ts** - evaluateConditions helper
- **packages/utils/src/** - Utility wrappers (retry, timeout, validation)
- **packages/anthropic/src/adapter.ts** - Anthropic integration
- **packages/openai/src/adapter.ts** - OpenAI integration
- **packages/gemini/src/adapter.ts** - Gemini integration
