# agentiny

**Build autonomous reactive agents with TypeScript** - A lightweight, modular framework for creating intelligent systems using trigger-condition-action flows.

Zero dependencies. Full TypeScript support. Less than 5KB minified + gzipped. Perfect for automation, workflow orchestration, state machines, and AI-powered applications.

```typescript
import { Agent } from '@agentiny/core';

const agent = new Agent({ initialState: { count: 0 } });

agent.when((state) => state.count > 5, [(state) => console.log('Milestone reached:', state.count)]);

await agent.start();
agent.setState({ count: 10 }); // Triggers action
```

## Packages

The agentiny framework consists of modular packages designed to work together:

| Package                                       | Purpose                                         | Version                                                                                                       | Status        |
| --------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------- |
| **[@agentiny/core](packages/core)**           | Foundation - Trigger-condition-action framework | [![npm](https://img.shields.io/npm/v/@agentiny/core)](https://www.npmjs.com/package/@agentiny/core)           | ✅ Foundation |
| **[@agentiny/utils](packages/utils)**         | Utility helpers - Retry, timeout, validation    | [![npm](https://img.shields.io/npm/v/@agentiny/utils)](https://www.npmjs.com/package/@agentiny/utils)         | ✅ Ready      |
| **[@agentiny/openai](packages/openai)**       | OpenAI integration - AI-powered actions         | [![npm](https://img.shields.io/npm/v/@agentiny/openai)](https://www.npmjs.com/package/@agentiny/openai)       | ✅ Ready      |
| **[@agentiny/anthropic](packages/anthropic)** | Anthropic integration - Claude API support      | [![npm](https://img.shields.io/npm/v/@agentiny/anthropic)](https://www.npmjs.com/package/@agentiny/anthropic) | ✅ Ready      |
| **[@agentiny/gemini](packages/gemini)**       | Google Gemini integration                       | [![npm](https://img.shields.io/npm/v/@agentiny/gemini)](https://www.npmjs.com/package/@agentiny/gemini)       | ✅ Ready      |

## Package Dependencies

```
@agentiny/core (foundation)
│
├── @agentiny/utils (extends core with utilities)
│
├── @agentiny/openai (uses core for AI actions)
│
├── @agentiny/anthropic (uses core for AI actions)
│
└── @agentiny/gemini (uses core for AI actions)
```

## Quick Start

### 1. Install the core framework

```bash
npm install @agentiny/core
```

### 2. Create your first agent

```typescript
import { Agent } from '@agentiny/core';

interface AppState {
  temperature: number;
  alarm: boolean;
}

const agent = new Agent<AppState>({
  initialState: { temperature: 0, alarm: false },
});

// Trigger when temperature exceeds 30°C
agent.when(
  (state) => state.temperature > 30,
  [(state) => (state.alarm = true), (state) => console.log('⚠️ Alert!')],
);

// Reset alarm when temperature normalizes
agent.when(
  (state) => state.temperature <= 25,
  [(state) => (state.alarm = false), (state) => console.log('✅ Normal')],
);

await agent.start();

// Simulate temperature changes
agent.setState({ temperature: 35 }); // Triggers alarm
agent.setState({ temperature: 20 }); // Resets alarm

await agent.stop();
```

### 3. Add AI capabilities (Optional)

```typescript
import { Agent } from '@agentiny/core';
import { createAnthropicAction } from '@agentiny/anthropic';

const agent = new Agent({ initialState: { userInput: '' } });

const aiAction = createAnthropicAction({
  prompt: (state) => `Respond to: ${state.userInput}`,
  model: 'claude-3-sonnet-20240229',
  apiKey: process.env.ANTHROPIC_API_KEY,
});

agent.when((state) => state.userInput.length > 0, [aiAction]);

await agent.start();
agent.setState({ userInput: 'Hello, how are you?' });
```

## Core Concepts

### Triggers

Functions that determine **when** to act:

```typescript
// State-based trigger
(state) => state.count > 5;

// Event-based trigger
agent.on('user-login', [action]);
```

### Conditions

Optional validation before executing actions:

```typescript
agent.when(
  (state) => state.count > 5, // trigger
  [(state) => state.approved], // condition
  [(state) => executeAction(state)], // actions
);
```

### Actions

Functions that **do something** when triggered:

```typescript
(state) => {
  state.count = 0;
  console.log('Reset!');
};
```

## Use Cases

- **Workflow Automation** - Automate multi-step processes with conditional logic
- **Event-Driven Systems** - Build responsive applications that react to state changes
- **State Machines** - Implement complex state management elegantly
- **AI-Powered Agents** - Create intelligent agents using AI models
- **Real-time Monitoring** - Monitor conditions and trigger alerts or actions
- **Business Logic Orchestration** - Coordinate complex business rules

## Documentation

### Core Framework

- **[Core README](packages/core/README.md)** - Complete framework documentation
- **[API Reference](packages/core#api-reference)** - Detailed method documentation
- **[Examples](packages/core#examples)** - Real-world usage examples

### Extensions & Integrations

- **[Utils](packages/utils)** - Utility helpers and wrappers
- **[OpenAI](packages/openai)** - Create AI actions with OpenAI
- **[Anthropic](packages/anthropic)** - Integrate Claude for AI capabilities
- **[Gemini](packages/gemini)** - Google Gemini AI integration

## Features

✅ **Zero Dependencies** - Minimal footprint, no runtime dependencies
✅ **Type-Safe** - Full TypeScript support with strict mode
✅ **Event-Driven** - Immediate trigger evaluation on state changes (0ms latency)
✅ **Flexible** - Repeating triggers, one-time triggers, event-based triggers
✅ **Async/Await** - Full async support for all operations
✅ **Small Bundle** - Less than 5KB minified + gzipped
✅ **Well-Tested** - 155 comprehensive tests
✅ **CPU-Efficient** - Configurable idle timeout reduces CPU usage when idle
✅ **Cascading Support** - Wait for all cascading actions to complete with `settle()`

## Development

### Setup

```bash
# Clone and install
git clone https://github.com/keldrik/agentiny.git
cd agentiny
npm install
```

### Common Commands

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Formatting
npm run format          # Check
npm run format:write    # Auto-fix

# Building
npm run build

# Testing (core package)
npm run test:run -w @agentiny/core
npm run test -w @agentiny/core    # Watch mode

# Build specific package
npm run build -w @agentiny/core
```

### Workspace Structure

```
agentiny/
├── packages/
│   ├── core/        # Foundation framework
│   ├── utils/       # Utilities and helpers
│   ├── openai/      # OpenAI integration
│   ├── anthropic/   # Anthropic integration
│   └── gemini/      # Google Gemini integration
├── package.json     # Workspace root
└── README.md        # This file
```

## Contributing

We welcome contributions! Here's how you can help:

1. **Report Issues** - Find a bug? Open an issue
2. **Suggest Features** - Have an idea? Discuss it in issues
3. **Submit PRs** - Fix bugs or add features
4. **Improve Docs** - Help us document better

### Development Workflow

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes and add tests
3. Run validation: `npm run typecheck && npm run lint && npm run format:write`
4. Build: `npm run build`
5. Commit and push to your fork
6. Open a PR with a clear description

## Ecosystem Examples

### Basic Agent (Core Only)

```typescript
import { Agent } from '@agentiny/core';

const agent = new Agent({ initialState: { done: false } });
agent.once((state) => state.done, [() => console.log('Complete!')]);
await agent.start();
agent.setState({ done: true });
```

### With Utilities

```typescript
import { Agent } from '@agentiny/core';
import { retry, timeout } from '@agentiny/utils';

const agent = new Agent({
  initialState: { retries: 0 },
  onError: retry({ maxAttempts: 3 }),
});
```

### With AI Integration

```typescript
import { Agent } from '@agentiny/core';
import { createAnthropicAction } from '@agentiny/anthropic';

const aiAction = createAnthropicAction({
  prompt: (state) => `Analyze: ${state.data}`,
  model: 'claude-3-sonnet-20240229',
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const agent = new Agent({ initialState: { data: '' } });
agent.when((state) => state.data.length > 0, [aiAction]);
```

### Waiting for Cascading Actions

The new `settle()` method allows you to wait for all cascading trigger-action flows to complete:

```typescript
import { Agent } from '@agentiny/core';

interface DocumentState {
  status: 'ready' | 'processing' | 'processed' | 'archived';
}

const agent = new Agent<DocumentState>({ initialState: { status: 'ready' } });

// Step 1: Ready → Processing
agent.when(
  (state) => state.status === 'ready',
  [
    (state) => {
      state.status = 'processing';
    },
  ],
);

// Step 2: Processing → Processed
agent.when(
  (state) => state.status === 'processing',
  [
    (state) => {
      state.status = 'processed';
    },
  ],
);

// Step 3: Processed → Archived
agent.when(
  (state) => state.status === 'processed',
  [
    (state) => {
      state.status = 'archived';
    },
  ],
);

await agent.start();
agent.setState({ status: 'ready' });

// Wait for all cascading actions to complete
await agent.settle();
console.log(agent.getState()); // { status: 'archived' }
```

### Configuring Idle Timeout

Tune CPU usage vs responsiveness for your use case:

```typescript
import { Agent } from '@agentiny/core';

// Low latency - check more frequently when idle
const agent = new Agent({
  initialState: {},
  idleTimeout: 50, // 50ms between checks when idle
});

// Background processing - save CPU
const agent = new Agent({
  initialState: {},
  idleTimeout: 500, // 500ms between checks when idle (default: 100ms)
});
```

Note: State changes and events always trigger immediate evaluation regardless of `idleTimeout`.

## Performance Metrics

- **Bundle Size**: < 5KB minified + gzipped (core only)
- **Dependencies**: 0 runtime dependencies
- **Type Safety**: Full TypeScript strict mode
- **Scalability**: Tested with 100+ concurrent triggers
- **Test Coverage**: 155+ tests across all packages

## Architecture

agentiny uses an **event-driven trigger-condition-action** architecture:

```
State Change / Event Emission
    ↓
Immediate Wake (0ms latency)
    ↓
Check Triggers
    ↓
Evaluate Conditions
    ↓
Execute Actions
    ↓
Update State (may cascade)
```

This creates a reactive system where agents automatically respond to state changes or events with immediate trigger evaluation. When idle, the agent uses a configurable timeout (default: 100ms) to minimize CPU usage.

## Browser Support

- Node.js 16+
- Modern browsers with ES2020 support
- Works with any framework (React, Vue, Angular, Svelte, etc.)

## License

MIT - See LICENSE file for details

## Resources

- 📚 **[Core Documentation](packages/core)**
- 🧪 **[Tests](packages/core/src)**
- 🤖 **[AI Integration Examples](packages/openai)**
- 💬 **[GitHub Issues](https://github.com/keldrik/agentiny/issues)**
- 📦 **[npm Package](https://www.npmjs.com/org/agentiny)**

## Security

- No external dependencies = no supply chain risk
- Full TypeScript type safety
- Error handling throughout
- Memory-safe cleanup

## Roadmap

- ✅ Core framework
- ✅ AI integrations (OpenAI, Anthropic, Gemini)
- ✅ Utilities (retry, timeout, validation)
- 🔄 Advanced features (persistence, clustering)
- 🔄 CLI tools for agent generation

## Support

- 📖 Read the [documentation](packages/core)
- 🐛 Report [issues on GitHub](https://github.com/keldrik/agentiny/issues)
- 💡 Check [examples](packages/core#examples)

---

**Made with ❤️ by the agentiny team**

Start building intelligent agents today. Install `@agentiny/core` and create your first agent in seconds.
