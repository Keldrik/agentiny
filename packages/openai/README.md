# @agentiny/openai

OpenAI adapter for [@agentiny/core](https://www.npmjs.com/package/@agentiny/core). Turns a state-in / state-out Chat Completions call into an agent `ActionFn`.

## Migration from 0.1.x

`0.2.0` is a breaking change:

- `createOpenAIAction(config, options)` is now a **single options object**.
- `onResponse` receives a result object. Use `result.text` for the previous string.
- `maxTokens` is sent as `max_completion_tokens` (required by GPT-5-class models).
- The default model is the `gpt-5-nano` alias, not a dated snapshot.

```typescript
// 0.1.x
createOpenAIAction(
  { apiKey: process.env.OPENAI_API_KEY! },
  {
    prompt: (state) => state.input,
    onResponse: (text, state) => {
      state.output = text;
    },
  },
);

// 0.2.0
createOpenAIAction({
  apiKey: process.env.OPENAI_API_KEY,
  prompt: (state) => state.input,
  onResponse: (result, state) => {
    state.output = result.text;
  },
});
```

## Installation

```bash
npm install @agentiny/core @agentiny/openai openai
```

### Requirements

- **Node.js** 18+ (Node 22+ if your app installs `openai` 7.x)
- **@agentiny/core** (peer)
- **openai** `^6.5.0 || ^7.0.0` (peer, install separately)
- **zod** `^3.25 || ^4.0` (optional peer, only if you pass a Zod schema)

### Other adapters

- [@agentiny/anthropic](https://www.npmjs.com/package/@agentiny/anthropic)
- [@agentiny/gemini](https://www.npmjs.com/package/@agentiny/gemini)

## Quick start

```typescript
import { createOpenAIAction } from '@agentiny/openai';
import { Agent } from '@agentiny/core';

interface AnalysisState {
  data: string;
  analysis?: string;
}

const agent = new Agent<AnalysisState>({
  initialState: { data: '' },
});

const analyzeAction = createOpenAIAction({
  apiKey: process.env.OPENAI_API_KEY,
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
agent.setState({ data: 'What is TypeScript?' });
```

## API

### `createOpenAIAction<TState, TParsed>(options)`

Creates an `ActionFn<TState>` that calls OpenAI Chat Completions.

The client is created once in the factory (or taken from `options.client`) and reused. When the agent passes an `ActionContext`, its abort signal is forwarded to the SDK.

#### Client

- `client` (optional) — Existing `OpenAI` instance or compatible client (`AzureOpenAI`, a mock, a proxy wrapper). When set, `apiKey` and `baseURL` are ignored.
- `apiKey` (optional) — Used when `client` is omitted. The SDK also reads `OPENAI_API_KEY`.
- `baseURL` (optional) — Custom endpoint. The SDK also reads `OPENAI_BASE_URL`.
- `model` (optional) — Default: `gpt-5-nano`.

#### Prompt (exactly one of `prompt` or `messages`)

- `prompt` — `(state) => string` turned into a single user message.
- `messages` — `(state) => OpenAIMessage[]` for multi-turn history stored on state.
- `system` — `string` or `(state) => string`, prepended as a system message.

#### Result

- `onResponse` — `(result, state) => void | Promise<void>`. Always receives:

  | Field          | Meaning                                                                      |
  | -------------- | ---------------------------------------------------------------------------- |
  | `text`         | Assistant text (empty string if missing)                                     |
  | `data`         | `text` when no `schema`; parsed value when `schema` is set                   |
  | `usage`        | `{ promptTokens, completionTokens, totalTokens }` when the API returns usage |
  | `finishReason` | API `finish_reason`, or `null`                                               |
  | `model`        | Model reported by the API (falls back to the requested model)                |
  | `raw`          | The completion or last stream chunk                                          |

- `onDelta` — `(delta, state) => void | Promise<void>`. Opts the request into streaming. Each non-empty text delta is emitted; `onResponse` still runs once at the end.

#### Generation

- `maxTokens` — Sent as `max_completion_tokens`. Never sent as the deprecated `max_tokens`.
- `temperature` — Optional passthrough. GPT-5-class models may reject it.
- `schema` — JSON Schema object, or a Zod-like object with `safeParse`. Enables structured output; `result.data` is the parsed value.
- `schemaName` — Name sent with JSON Schema structured output. Default: `response`.

## Examples

### Injected client

Share one client across actions (Azure, custom `fetch`, org/project, tests):

```typescript
import { OpenAI } from 'openai';
import { createOpenAIAction } from '@agentiny/openai';

const client = new OpenAI();

const action = createOpenAIAction({
  client,
  prompt: (state) => state.input,
  onResponse: (result, state) => {
    state.output = result.text;
  },
});
```

### System prompt and message history

```typescript
const reply = createOpenAIAction({
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
const creative = createOpenAIAction({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4.1-mini',
  prompt: (state) => `Write a short story about: ${state.topic}`,
  temperature: 1.2,
  maxTokens: 500,
  onResponse: (result, state) => {
    state.story = result.text;
  },
});
```

GPT-5-class models (`gpt-5-nano`, `gpt-5.6-*`, and other reasoning models) often reject `temperature`. Omit it unless you know the model accepts it.

### Structured output

JSON Schema:

```typescript
const extract = createOpenAIAction({
  prompt: (state) => state.email,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tasks: { type: 'array', items: { type: 'string' } },
    },
    required: ['tasks'],
  },
  schemaName: 'tasks',
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

const extract = createOpenAIAction({
  prompt: (state) => state.email,
  schema: TaskList,
  onResponse: (result, state) => {
    state.tasks = result.data.tasks;
  },
});
```

### Streaming into state

```typescript
const stream = createOpenAIAction({
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

const summarize = createOpenAIAction({
  apiKey: process.env.OPENAI_API_KEY,
  prompt: (state) => `Summarize: ${state.text}`,
  onResponse: (result, state) => {
    state.summary = result.text;
  },
});

const analyzeSentiment = createOpenAIAction({
  apiKey: process.env.OPENAI_API_KEY,
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

Prefer one shared `client` when several actions hit the same account.

### Custom endpoint

```typescript
const custom = createOpenAIAction({
  apiKey: process.env.CUSTOM_API_KEY,
  baseURL: 'https://your-openai-compatible-endpoint.example/v1',
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

## Best practices

1. Keep API keys in the environment; pass a shared `client` when you have more than one action.
2. Use a current model alias (`gpt-5-nano`, or a newer cheap/fast model) unless you need a pinned snapshot.
3. Set `maxTokens` to cap cost. Do not rely on `temperature` on GPT-5-class models.
4. Handle failures with the agent's `onError`. Observe `ctx.signal` is already done for you.
5. Use `schema` when the next trigger needs structured state, not a blob of prose.

## Troubleshooting

### "API key is missing or invalid"

Set `OPENAI_API_KEY`, pass `apiKey`, or inject a `client` that already has credentials.

### "Cannot find module 'openai'"

`openai` is a peer dependency: `npm install openai`.

### "Model not found"

The default is `gpt-5-nano`. Check that the name exists on your account, or set `model`.

### Temperature or `max_tokens` errors on GPT-5 models

This adapter sends `max_completion_tokens`. If you still see sampling-parameter errors, omit `temperature`.

### Rate limit exceeded

Wrap the action with `withRetry` from `@agentiny/utils`, or space calls out with a trigger `delay`.

## License

MIT

## See also

- [@agentiny/core](https://www.npmjs.com/package/@agentiny/core)
- [@agentiny/anthropic](https://www.npmjs.com/package/@agentiny/anthropic)
- [@agentiny/gemini](https://www.npmjs.com/package/@agentiny/gemini)
- [OpenAI API reference](https://platform.openai.com/docs/api-reference)
