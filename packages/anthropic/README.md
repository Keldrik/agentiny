# @agentiny/anthropic

Anthropic integration adapter for [@agentiny/core](https://github.com/anthropics/agenTiny). Enables agents to interact with Anthropic's Claude API.

## Installation

```bash
# Install @agentiny/core and this adapter
npm install @agentiny/core @agentiny/anthropic @anthropic-ai/sdk
```

## Quick Start

```typescript
import { createAnthropicAction } from "@agentiny/anthropic";
import { Agent } from "@agentiny/core";

interface AnalysisState {
  data: string;
  analysis?: string;
}

const agent = new Agent<AnalysisState>({
  initialState: { data: "" },
});

// Create an Anthropic action
const analyzeAction = createAnthropicAction(
  { apiKey: process.env.ANTHROPIC_API_KEY! },
  {
    prompt: (state) => `Analyze this: ${state.data}`,
    onResponse: (response, state) => {
      state.analysis = response;
      console.log("Analysis:", response);
    },
  }
);

// Add trigger to use the action
agent.addTrigger({
  id: "analyze-trigger",
  check: (state) => !!state.data && !state.analysis,
  actions: [analyzeAction],
  repeat: false,
});

// Start agent and set data
await agent.start();
agent.setState({ data: "What is Claude?" });
```

## API

### `createAnthropicAction<TState>(config, options)`

Creates an action function that calls the Anthropic API.

#### Parameters

- **config** - Anthropic configuration object

  - `apiKey` (string, required) - Anthropic API key
  - `model` (string, optional) - Model to use (default: `claude-3-haiku-20240307`)
  - `baseURL` (string, optional) - Custom API endpoint URL

- **options** - Action options object
  - `prompt` (function, required) - Function that generates prompt from state: `(state: TState) => string`
  - `onResponse` (function, required) - Callback when response arrives: `(response: string, state: TState) => void`
  - `maxTokens` (number, optional) - Maximum tokens in response (default: 1024)
  - `temperature` (number, optional) - Sampling temperature (0-1)

#### Returns

An `ActionFn<TState>` that can be used in agent triggers.

## Examples

### Basic Analysis

```typescript
import { createAnthropicAction } from "@agentiny/anthropic";
import { Agent } from "@agentiny/core";

interface TextState {
  input: string;
  output?: string;
}

const agent = new Agent<TextState>({
  initialState: { input: "Hello world" },
});

agent.addTrigger({
  id: "translate",
  check: (state) => !!state.input && !state.output,
  actions: [
    createAnthropicAction(
      { apiKey: process.env.ANTHROPIC_API_KEY! },
      {
        prompt: (state) => `Translate to French: ${state.input}`,
        onResponse: (response, state) => {
          state.output = response;
        },
      }
    ),
  ],
});

await agent.start();
```

### Using Different Models

```typescript
import { createAnthropicAction } from "@agentiny/anthropic";

const advancedAnalysis = createAnthropicAction(
  {
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: "claude-3-opus-20240229", // Use Claude 3 Opus for best quality
  },
  {
    prompt: (state) => `Advanced analysis: ${state.data}`,
    onResponse: (response, state) => {
      state.analysis = response;
    },
  }
);
```

### With Temperature and Max Tokens

```typescript
import { createAnthropicAction } from "@agentiny/anthropic";

const creativeResponse = createAnthropicAction(
  { apiKey: process.env.ANTHROPIC_API_KEY! },
  {
    prompt: (state) => `Write a creative story about: ${state.topic}`,
    onResponse: (response, state) => {
      state.story = response;
    },
    temperature: 0.8, // Creative (0-1 range)
    maxTokens: 500, // Limit response length
  }
);
```

### Chained Actions with Multiple Stages

```typescript
import { createAnthropicAction } from "@agentiny/anthropic";
import { Agent } from "@agentiny/core";

interface ProcessState {
  text: string;
  summary?: string;
  sentiment?: string;
}

const agent = new Agent<ProcessState>({
  initialState: { text: "Your text here" },
});

// Stage 1: Summarize
const summarize = createAnthropicAction(
  { apiKey: process.env.ANTHROPIC_API_KEY! },
  {
    prompt: (state) => `Summarize: ${state.text}`,
    onResponse: (response, state) => {
      state.summary = response;
    },
  }
);

// Stage 2: Analyze sentiment
const analyzeSentiment = createAnthropicAction(
  { apiKey: process.env.ANTHROPIC_API_KEY! },
  {
    prompt: (state) => `Analyze sentiment of: ${state.summary}`,
    onResponse: (response, state) => {
      state.sentiment = response;
    },
  }
);

// First trigger: summarize when text is provided
agent.addTrigger({
  id: "summarize-trigger",
  check: (state) => !!state.text && !state.summary,
  actions: [summarize],
});

// Second trigger: analyze after summarization
agent.addTrigger({
  id: "analyze-trigger",
  check: (state) => !!state.summary && !state.sentiment,
  actions: [analyzeSentiment],
});

await agent.start();
```

### Custom API Endpoint

```typescript
import { createAnthropicAction } from "@agentiny/anthropic";

const customAction = createAnthropicAction(
  {
    apiKey: process.env.CUSTOM_API_KEY!,
    baseURL: "https://your-custom-endpoint.com",
  },
  {
    prompt: (state) => `Process: ${state.data}`,
    onResponse: (response, state) => {
      state.result = response;
    },
  }
);
```

## Model Options

Anthropic offers several Claude models:

- **claude-3-haiku-20240307** (default) - Fast and compact, ideal for simple tasks
- **claude-3-sonnet-20240229** - Balanced performance and quality
- **claude-3-opus-20240229** - Most capable, best for complex reasoning

```typescript
// Using Claude 3 Sonnet
const action = createAnthropicAction(
  {
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: "claude-3-sonnet-20240229",
  },
  {
    prompt: (state) => `Analyze: ${state.data}`,
    onResponse: (response, state) => {
      state.result = response;
    },
  }
);
```

## Error Handling

Errors from the Anthropic API are propagated and can be caught:

```typescript
agent.addTrigger({
  id: "api-call",
  check: (state) => !!state.input,
  actions: [
    createAnthropicAction(
      { apiKey: process.env.ANTHROPIC_API_KEY! },
      {
        prompt: (state) => state.input,
        onResponse: (response, state) => {
          state.output = response;
        },
      }
    ),
  ],
});

// Capture errors via agent's onError callback
const agent = new Agent<TextState>({
  initialState: { input: "" },
  onError: (error) => {
    console.error("Agent error:", error.message);
  },
});
```

## Type Safety

The adapter provides full TypeScript support with type-safe state handling:

```typescript
import { createAnthropicAction } from "@agentiny/anthropic";
import type { ActionFn } from "@agentiny/core";

interface DataState {
  input: string;
  processed?: string;
  score?: number;
}

// TypeScript ensures prompt and onResponse match state type
const action: ActionFn<DataState> = createAnthropicAction(
  { apiKey: process.env.ANTHROPIC_API_KEY! },
  {
    prompt: (state) => {
      // state is typed as DataState
      return `Process: ${state.input}`;
    },
    onResponse: (response, state) => {
      // state is typed as DataState
      state.processed = response;
    },
  }
);
```

## Best Practices

1. **Use environment variables for API keys** - Never hardcode secrets
2. **Choose appropriate models** - Use Haiku for speed, Opus for quality
3. **Set temperature appropriately** - Lower (0.2-0.5) for deterministic tasks, higher (0.7-1.0) for creative
4. **Set max tokens** - Use reasonable limits to control costs and response times
5. **Handle errors** - Use agent's `onError` callback for error handling
6. **Test thoroughly** - Write tests for your state transformations
7. **Monitor usage** - Track token usage to manage costs

## Supported Features

- ✅ Full Claude model family support
- ✅ Type-safe state handling with TypeScript
- ✅ Configurable temperature and max tokens
- ✅ Custom API endpoints
- ✅ Error handling and propagation
- ✅ Integration with @agentiny/core agents

## License

MIT
