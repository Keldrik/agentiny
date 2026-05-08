# agentiny

Build reactive agents in TypeScript with state, triggers, conditions, and actions.

Zero runtime dependencies. Full TypeScript support. Designed for in-process automation, workflow orchestration, and AI-assisted actions.

```typescript
import { Agent } from '@agentiny/core';

const agent = new Agent({ initialState: { count: 0 } });

agent.when(
  (state) => state.count > 5,
  [(state) => console.log('Milestone reached:', state.count)],
);

await agent.start();
agent.setState({ count: 10 });
await agent.settle();
```

## Packages

| Package | Purpose | Status |
| --- | --- | --- |
| **[@agentiny/core](packages/core)** | Core trigger-condition-action framework | Foundation |
| **[@agentiny/utils](packages/utils)** | Retry, timeout, and validation helpers | Ready |
| **[@agentiny/openai](packages/openai)** | OpenAI-backed agent actions | Ready |
| **[@agentiny/anthropic](packages/anthropic)** | Anthropic-backed agent actions | Ready |
| **[@agentiny/gemini](packages/gemini)** | Google Gemini-backed agent actions | Ready |

## Quick Start

### Install the core package

```bash
npm install @agentiny/core
```

### Create an agent

```typescript
import { Agent } from '@agentiny/core';

interface AppState {
  temperature: number;
  alarm: boolean;
}

const agent = new Agent<AppState>({
  initialState: { temperature: 0, alarm: false },
});

agent.when(
  (state) => state.temperature > 30,
  [(state) => (state.alarm = true), (state) => console.log('Alert!')],
);

agent.when(
  (state) => state.temperature <= 25,
  [(state) => (state.alarm = false), (state) => console.log('Normal')],
);

await agent.start();
agent.setState({ temperature: 35 });
agent.setState({ temperature: 20 });
await agent.stop();
```

### Schedule actions on time

`every(interval, ...)` fires repeatedly. The interval is either milliseconds or a
duration string (`ms`, `s`, `m`, `h`). `at(time, ...)` fires at a wall-clock time
in the host's local timezone — `"HH:MM"` (24h) or `"9:30pm"` / `"9:30 AM"` (12h);
repeats daily, or pass `{ once: true }` for a single-shot.

```typescript
agent.every('2h', [refreshFeed]);
agent.every('5s', [poll], { immediate: true });
agent.at('21:30', [sendDailyReport]);
agent.at('00:00', [resetCounters], { once: true });
```

### Add AI actions

```typescript
import { Agent } from '@agentiny/core';
import { createAnthropicAction } from '@agentiny/anthropic';

const aiAction = createAnthropicAction({
  prompt: (state) => `Respond to: ${state.userInput}`,
  model: 'claude-3-sonnet-20240229',
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const agent = new Agent({ initialState: { userInput: '' } });
agent.when((state) => state.userInput.length > 0, [aiAction]);
```

## Core Concepts

- **Triggers** decide when an agent should act, using state checks, named events, or wall-clock time.
- **Conditions** add extra guards before actions run.
- **Actions** mutate state or perform side effects.
- **`settle()`** waits for cascading trigger/action chains to finish.

## Documentation

- **[Core README](packages/core/README.md)** - Full core package documentation
- **[Utils](packages/utils)** - Retry, timeout, and validation helpers
- **[OpenAI](packages/openai)** - OpenAI integration
- **[Anthropic](packages/anthropic)** - Anthropic integration
- **[Gemini](packages/gemini)** - Google Gemini integration

## Development

```bash
git clone https://github.com/keldrik/agentiny.git
cd agentiny
npm install
```

Common commands:

```bash
npm run typecheck
npm run lint
npm run format
npm run build
npm run test:run -w @agentiny/core
```

## License

MIT - See LICENSE for details.
