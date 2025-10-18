# @agentiny/openai

OpenAI integration adapter for [@agentiny/core](https://www.npmjs.com/package/@agentiny/core). Enables agents to interact with OpenAI's chat completion API through the agenTiny agent framework.

This adapter allows you to build reactive agents that can call OpenAI's LLMs as part of trigger-condition-action flows, enabling sophisticated multi-step AI workflows.

## About agenTiny

**agenTiny** is a lightweight TypeScript agent framework (< 5KB gzipped) for building reactive agents using trigger-condition-action flows. It features:

- ⚡ Zero runtime dependencies (for core)
- 🎯 Type-safe state management
- 🔄 Full async/await support
- 🎨 Clean, reactive trigger system

For more information, see [agenTiny on npm](https://www.npmjs.com/package/@agentiny/core) or the [GitHub repository](https://github.com/Keldrik/agentiny).

## Installation

```bash
# Install @agentiny/core and this adapter
npm install @agentiny/core @agentiny/openai openai
```

### Requirements

- **Node.js** 18+ (or equivalent runtime with top-level await support)
- **@agentiny/core** ^0.1.2
- **openai** ^6.5.0 (tested with 6.5.0)

### Other Adapters

If you prefer other LLM providers, agenTiny also provides:

- [@agentiny/anthropic](https://www.npmjs.com/package/@agentiny/anthropic) - Claude models via Anthropic
- [@agentiny/gemini](https://www.npmjs.com/package/@agentiny/gemini) - Google Gemini models

## Quick Start

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

// Create an OpenAI action
const analyzeAction = createOpenAIAction(
  { apiKey: process.env.OPENAI_API_KEY! },
  {
    prompt: (state) => `Analyze this: ${state.data}`,
    onResponse: (response, state) => {
      state.analysis = response;
      console.log('Analysis:', response);
    },
  },
);

// Add trigger to use the action
agent.addTrigger({
  id: 'analyze-trigger',
  check: (state) => !!state.data && !state.analysis,
  actions: [analyzeAction],
  repeat: false,
});

// Start agent and set data
await agent.start();
agent.setState({ data: 'What is TypeScript?' });
```

## API

### `createOpenAIAction<TState>(config, options)`

Creates an action function that calls the OpenAI API.

#### Parameters

- **config** - OpenAI configuration object
  - `apiKey` (string, required) - OpenAI API key
  - `model` (string, optional) - Model to use (default: `gpt-3.5-turbo`)
  - `baseURL` (string, optional) - Custom API endpoint URL

- **options** - Action options object
  - `prompt` (function, required) - Function that generates prompt from state: `(state: TState) => string`
  - `onResponse` (function, required) - Callback when response arrives: `(response: string, state: TState) => void`
  - `maxTokens` (number, optional) - Maximum tokens in response
  - `temperature` (number, optional) - Sampling temperature (0-2)

#### Returns

An `ActionFn<TState>` that can be used in agent triggers.

## Examples

### Basic Analysis

```typescript
import { createOpenAIAction } from '@agentiny/openai';
import { Agent } from '@agentiny/core';

interface TextState {
  input: string;
  output?: string;
}

const agent = new Agent<TextState>({
  initialState: { input: 'Hello world' },
});

agent.addTrigger({
  id: 'translate',
  check: (state) => !!state.input && !state.output,
  actions: [
    createOpenAIAction(
      { apiKey: process.env.OPENAI_API_KEY! },
      {
        prompt: (state) => `Translate to French: ${state.input}`,
        onResponse: (response, state) => {
          state.output = response;
        },
      },
    ),
  ],
});

await agent.start();
```

### Using Different Models

```typescript
import { createOpenAIAction } from '@agentiny/openai';

const advancedAnalysis = createOpenAIAction(
  {
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-5-2025-08-07',
  },
  {
    prompt: (state) => `Advanced analysis: ${state.data}`,
    onResponse: (response, state) => {
      state.analysis = response;
    },
  },
);
```

### With Temperature and Max Tokens

```typescript
import { createOpenAIAction } from '@agentiny/openai';

const creativeResponse = createOpenAIAction(
  { apiKey: process.env.OPENAI_API_KEY! },
  {
    prompt: (state) => `Write a creative story about: ${state.topic}`,
    onResponse: (response, state) => {
      state.story = response;
    },
    temperature: 1.5, // More creative (0-2 range)
    maxTokens: 500, // Limit response length
  },
);
```

### Chained Actions with Multiple Stages

```typescript
import { createOpenAIAction } from '@agentiny/openai';
import { Agent } from '@agentiny/core';

interface ProcessState {
  text: string;
  summary?: string;
  sentiment?: string;
}

const agent = new Agent<ProcessState>({
  initialState: { text: 'Your text here' },
});

// Stage 1: Summarize
const summarize = createOpenAIAction(
  { apiKey: process.env.OPENAI_API_KEY! },
  {
    prompt: (state) => `Summarize: ${state.text}`,
    onResponse: (response, state) => {
      state.summary = response;
    },
  },
);

// Stage 2: Analyze sentiment
const analyzeSentiment = createOpenAIAction(
  { apiKey: process.env.OPENAI_API_KEY! },
  {
    prompt: (state) => `Analyze sentiment of: ${state.summary}`,
    onResponse: (response, state) => {
      state.sentiment = response;
    },
  },
);

// First trigger: summarize when text is provided
agent.addTrigger({
  id: 'summarize-trigger',
  check: (state) => !!state.text && !state.summary,
  actions: [summarize],
});

// Second trigger: analyze after summarization
agent.addTrigger({
  id: 'analyze-trigger',
  check: (state) => !!state.summary && !state.sentiment,
  actions: [analyzeSentiment],
});

await agent.start();
```

### Custom API Endpoint

```typescript
import { createOpenAIAction } from '@agentiny/openai';

const customAction = createOpenAIAction(
  {
    apiKey: process.env.CUSTOM_API_KEY!,
    baseURL: 'https://your-custom-openai-endpoint.com/v1',
  },
  {
    prompt: (state) => `Process: ${state.data}`,
    onResponse: (response, state) => {
      state.result = response;
    },
  },
);
```

## Error Handling

Errors from the OpenAI API are propagated and can be caught:

```typescript
agent.addTrigger({
  id: 'api-call',
  check: (state) => !!state.input,
  actions: [
    createOpenAIAction(
      { apiKey: process.env.OPENAI_API_KEY! },
      {
        prompt: (state) => state.input,
        onResponse: (response, state) => {
          state.output = response;
        },
      },
    ),
  ],
});

// Capture errors via agent's onError callback
const agent = new Agent<TextState>({
  initialState: { input: '' },
  onError: (error) => {
    console.error('Agent error:', error.message);
  },
});
```

## Type Safety

The adapter provides full TypeScript support with type-safe state handling:

```typescript
import { createOpenAIAction } from '@agentiny/openai';
import type { ActionFn } from '@agentiny/core';

interface DataState {
  input: string;
  processed?: string;
  score?: number;
}

// TypeScript ensures prompt and onResponse match state type
const action: ActionFn<DataState> = createOpenAIAction(
  { apiKey: process.env.OPENAI_API_KEY! },
  {
    prompt: (state) => {
      // state is typed as DataState
      return `Process: ${state.input}`;
    },
    onResponse: (response, state) => {
      // state is typed as DataState
      state.processed = response;
    },
  },
);
```

## Best Practices

1. **Use environment variables for API keys** - Never hardcode secrets
2. **Choose appropriate models** - Use `gpt-3.5-turbo` for speed, `gpt-4` for quality
3. **Set temperature appropriately** - Lower (0.2-0.7) for deterministic tasks, higher (0.8-1.5) for creative
4. **Limit max tokens** - Set reasonable limits to control costs
5. **Handle errors** - Use agent's `onError` callback for error handling
6. **Test thoroughly** - Write tests for your state transformations

## Troubleshooting

### "API key is missing or invalid"

- Ensure `OPENAI_API_KEY` environment variable is set with a valid API key
- Check that your API key has the necessary permissions
- Verify you're using an API key (not your account password)

### "Error: Cannot find module 'openai'"

- Ensure `openai` is installed: `npm install openai`
- Remember that `openai` is a peer dependency and must be installed separately

### "Model not found" error

- Verify the model name is correct and available in your OpenAI account

### "Rate limit exceeded"

- Implement retry logic with exponential backoff
- Consider using `@agentiny/utils` for the `withRetry` wrapper
- Spread out API calls using the `delay` trigger option

## API Reference

For detailed API documentation:

- Check [@agentiny/core documentation](https://www.npmjs.com/package/@agentiny/core) for Agent API
- See [OpenAI API Reference](https://platform.openai.com/docs/api-reference) for model details

## Contributing

Contributions are welcome! Please ensure:

- Code passes TypeScript strict mode checks
- ESLint rules are followed
- Changes are well-documented

## License

MIT

## See Also

- [@agentiny/core](https://www.npmjs.com/package/@agentiny/core) - Core agent framework
- [@agentiny/anthropic](https://www.npmjs.com/package/@agentiny/anthropic) - Anthropic adapter
- [@agentiny/gemini](https://www.npmjs.com/package/@agentiny/gemini) - Google Gemini adapter
- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference)
