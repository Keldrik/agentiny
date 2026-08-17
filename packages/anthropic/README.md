# @agentiny/anthropic

Anthropic adapter for [@agentiny/core](https://www.npmjs.com/package/@agentiny/core). Turns a state-in / state-out Claude Messages call into an agent `ActionFn`.

## Migration from 0.1.x

`0.2.0` is a breaking change:

- `createAnthropicAction(config, options)` is now a **single options object**.
- `onResponse` receives a result object. Use `result.text` for the previous string.
- The default model is still the `claude-haiku-4-5` alias.
- `maxTokens` is still sent as required `max_tokens` (default 1024).

```typescript
// 0.1.x
createAnthropicAction(
  { apiKey: process.env.ANTHROPIC_API_KEY! },
  {
    prompt: (state) => state.input,
    onResponse: (text, state) => {
      state.output = text;
    },
  },
);

// 0.2.0
createAnthropicAction({
  apiKey: process.env.ANTHROPIC_API_KEY,
  prompt: (state) => state.input,
  onResponse: (result, state) => {
    state.output = result.text;
  },
});
```

## Installation

```bash
npm install @agentiny/core @agentiny/anthropic @anthropic-ai/sdk
```

### Requirements

- **Node.js** 18+
- **@agentiny/core** (peer)
- **@anthropic-ai/sdk** `>=0.67.0 <1.0.0` (peer, install separately)
- **zod** `^3.25 || ^4.0` (optional peer, only if you pass a Zod schema)

### Other adapters

- [@agentiny/openai](https://www.npmjs.com/package/@agentiny/openai)
- [@agentiny/gemini](https://www.npmjs.com/package/@agentiny/gemini)

## Quick start

```typescript
import { createAnthropicAction } from '@agentiny/anthropic';
import { Agent } from '@agentiny/core';

interface AnalysisState {
  data: string;
  analysis?: string;
}

const agent = new Agent<AnalysisState>({
  initialState: { data: '' },
});

const analyzeAction = createAnthropicAction({
  apiKey: process.env.ANTHROPIC_API_KEY,
  prompt: (state) => `Analyze this: ${state.data}`,
  onResponse: (result, state) => {
    state.analysis = result.text;
  },
});

agent.addTrigger({
  id: 'analyze-trigger',
  check: (state) => !!state.data && !state.analysis,
  actions: [analyzeAction],
  repeat: false,
});

await agent.start();
agent.setState({ data: 'What is Claude?' });
```

## API

### `createAnthropicAction<TState, TParsed>(options)`

Creates an `ActionFn<TState>` that calls the Anthropic Messages API.

The client is created once in the factory (or taken from `options.client`) and reused. When the agent passes an `ActionContext`, its abort signal is forwarded to the SDK.

#### Client

- `client` (optional) — Existing `Anthropic` instance or compatible client. When set, `apiKey` and `baseURL` are ignored.
- `apiKey` (optional) — Used when `client` is omitted. The SDK also reads `ANTHROPIC_API_KEY`.
- `baseURL` (optional) — Custom endpoint. The SDK also reads `ANTHROPIC_BASE_URL`.
- `model` (optional) — Default: `claude-haiku-4-5`.

#### Prompt (exactly one of `prompt` or `messages`)

- `prompt` — `(state) => string` turned into a single user message.
- `messages` — `(state) => AnthropicMessage[]` for multi-turn history. Roles must be `user` or `assistant` only.
- `system` — `string` or `(state) => string`. Sent as the top-level Messages API `system` field, **not** as a `role: 'system'` message.

#### Result

- `onResponse` — `(result, state) => void | Promise<void>`. Always receives:

  | Field          | Meaning                                                                                        |
  | -------------- | ---------------------------------------------------------------------------------------------- |
  | `text`         | Concatenated text blocks (empty string if none)                                                |
  | `data`         | `text` when no `schema`; parsed value when `schema` is set                                     |
  | `usage`        | `{ promptTokens, completionTokens, totalTokens }` mapped from `input_tokens` / `output_tokens` |
  | `finishReason` | API `stop_reason`, or `null`                                                                   |
  | `model`        | Model reported by the API (falls back to the requested model)                                  |
  | `raw`          | The message or last stream event                                                               |

- `onDelta` — `(delta, state) => void | Promise<void>`. Uses `messages.stream()` when available, otherwise `create({ stream: true })`. `onResponse` still runs once at the end.

#### Generation

- `maxTokens` — Sent as required `max_tokens`. Default: `1024`.
- `temperature` — Optional passthrough (0–1).
- `schema` — JSON Schema object, or a Zod-like object with `safeParse`. Enables structured output; `result.data` is the parsed value.
- `schemaName` — Kept for adapter API parity. Claude’s `output_config.format` has no name field.

## Examples

### Injected client

```typescript
import { Anthropic } from '@anthropic-ai/sdk';
import { createAnthropicAction } from '@agentiny/anthropic';

const client = new Anthropic();

const action = createAnthropicAction({
  client,
  prompt: (state) => state.input,
  onResponse: (result, state) => {
    state.output = result.text;
  },
});
```

### System prompt and message history

History must be `user` / `assistant` turns. The system prompt is a separate field:

```typescript
const reply = createAnthropicAction({
  client,
  system: 'You are terse.',
  messages: (state) => state.history,
  onResponse: (result, state) => {
    state.history.push({ role: 'assistant', content: result.text });
  },
});
```

### Temperature and max tokens

```typescript
const creative = createAnthropicAction({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-5',
  prompt: (state) => `Write a short story about: ${state.topic}`,
  temperature: 0.8,
  maxTokens: 500,
  onResponse: (result, state) => {
    state.story = result.text;
  },
});
```

### Structured output

JSON Schema (sent as `output_config.format`):

```typescript
const extract = createAnthropicAction({
  prompt: (state) => state.email,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tasks: { type: 'array', items: { type: 'string' } },
    },
    required: ['tasks'],
  },
  onResponse: (result, state) => {
    state.tasks = result.data.tasks;
  },
});
```

Zod (optional peer — install `zod` yourself):

```typescript
import { z } from 'zod';

const TaskList = z.object({
  tasks: z.array(z.string()),
});

const extract = createAnthropicAction({
  prompt: (state) => state.email,
  schema: TaskList,
  onResponse: (result, state) => {
    state.tasks = result.data.tasks;
  },
});
```

### Streaming into state

```typescript
const stream = createAnthropicAction({
  prompt: (state) => state.prompt,
  onDelta: (delta, state) => {
    state.draft += delta;
  },
  onResponse: (result, state) => {
    state.draft = result.text;
  },
});
```

`onDelta` plus `schema` is allowed: deltas are the raw text (usually JSON), and `result.data` is parsed after the stream ends.

### Chained triggers

```typescript
interface ProcessState {
  text: string;
  summary?: string;
  sentiment?: string;
}

const agent = new Agent<ProcessState>({
  initialState: { text: 'Your text here' },
});

const client = new Anthropic();

const summarize = createAnthropicAction({
  client,
  prompt: (state) => `Summarize: ${state.text}`,
  onResponse: (result, state) => {
    state.summary = result.text;
  },
});

const analyzeSentiment = createAnthropicAction({
  client,
  prompt: (state) => `Analyze sentiment of: ${state.summary}`,
  onResponse: (result, state) => {
    state.sentiment = result.text;
  },
});

agent.addTrigger({
  id: 'summarize-trigger',
  check: (state) => !!state.text && !state.summary,
  actions: [summarize],
});

agent.addTrigger({
  id: 'analyze-trigger',
  check: (state) => !!state.summary && !state.sentiment,
  actions: [analyzeSentiment],
});
```

### Custom endpoint

```typescript
const custom = createAnthropicAction({
  apiKey: process.env.CUSTOM_API_KEY,
  baseURL: 'https://your-anthropic-compatible-endpoint.example',
  prompt: (state) => `Process: ${state.data}`,
  onResponse: (result, state) => {
    state.result = result.text;
  },
});
```

### Errors and cancellation

API errors and abort errors propagate to the agent's `onError`. Long-running calls stop when the agent is paused or stopped because `ctx.signal` is forwarded.

```typescript
const agent = new Agent<TextState>({
  initialState: { input: '' },
  onError: (error) => {
    console.error('Agent error:', error.message);
  },
});
```

For retries, wrap the action with `@agentiny/utils` `withRetry`.

## Models

Use current aliases unless you need a pinned snapshot:

| Alias              | Role                                          |
| ------------------ | --------------------------------------------- |
| `claude-haiku-4-5` | Default. Fastest and cheapest.                |
| `claude-sonnet-5`  | Balanced speed and quality.                   |
| `claude-opus-5`    | Complex work.                                 |
| `claude-fable-5`   | Frontier capability. Not the adapter default. |

## Best practices

1. Keep API keys in the environment; pass a shared `client` when you have more than one action.
2. Prefer aliases (`claude-haiku-4-5`, `claude-sonnet-5`) over dated snapshots.
3. Set `maxTokens` when you need more or less than the 1024 default. Anthropic requires this field.
4. Keep conversation history as alternating `user` / `assistant` turns. Put instructions in `system`.
5. Use `schema` when the next trigger needs structured state.

## Troubleshooting

### "API key is missing or invalid"

Set `ANTHROPIC_API_KEY`, pass `apiKey`, or inject a `client` that already has credentials.

### "Cannot find module '@anthropic-ai/sdk'"

`@anthropic-ai/sdk` is a peer dependency: `npm install @anthropic-ai/sdk`.

### "system: Extra inputs are not permitted" / invalid role

Do not put `{ role: 'system' }` in `messages`. Use the `system` option.

### Rate limit exceeded

Wrap the action with `withRetry` from `@agentiny/utils`, or space calls out with a trigger `delay`.

## License

MIT

## See also

- [@agentiny/core](https://www.npmjs.com/package/@agentiny/core)
- [@agentiny/openai](https://www.npmjs.com/package/@agentiny/openai)
- [@agentiny/gemini](https://www.npmjs.com/package/@agentiny/gemini)
- [Anthropic API reference](https://docs.anthropic.com/en/api/messages)
