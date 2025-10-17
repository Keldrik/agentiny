# @agentiny/gemini

Google Generative AI integration adapter for [@agentiny/core](https://github.com/anthropics/agenTiny). Enables agents to interact with Google's Gemini API.

## Installation

```bash
# Install @agentiny/core and this adapter
npm install @agentiny/core @agentiny/gemini @google/generative-ai
```

## Quick Start

```typescript
import { createGeminiAction } from '@agentiny/gemini';
import { Agent } from '@agentiny/core';

interface AnalysisState {
  data: string;
  analysis?: string;
}

const agent = new Agent<AnalysisState>({
  initialState: { data: '' }
});

// Create a Gemini action
const analyzeAction = createGeminiAction(
  { apiKey: process.env.GOOGLE_API_KEY! },
  {
    prompt: (state) => `Analyze this: ${state.data}`,
    onResponse: (response, state) => {
      state.analysis = response;
      console.log('Analysis:', response);
    }
  }
);

// Add trigger to use the action
agent.addTrigger({
  id: 'analyze-trigger',
  check: (state) => !!state.data && !state.analysis,
  actions: [analyzeAction],
  repeat: false
});

// Start agent and set data
await agent.start();
agent.setState({ data: 'What is Gemini?' });
```

## API

### `createGeminiAction<TState>(config, options)`

Creates an action function that calls the Gemini API.

#### Parameters

- **config** - Gemini configuration object
  - `apiKey` (string, required) - Google API key
  - `model` (string, optional) - Model to use (default: `gemini-1.5-flash`)
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
import { createGeminiAction } from '@agentiny/gemini';
import { Agent } from '@agentiny/core';

interface TextState {
  input: string;
  output?: string;
}

const agent = new Agent<TextState>({
  initialState: { input: 'Hello world' }
});

agent.addTrigger({
  id: 'translate',
  check: (state) => !!state.input && !state.output,
  actions: [
    createGeminiAction(
      { apiKey: process.env.GOOGLE_API_KEY! },
      {
        prompt: (state) => `Translate to French: ${state.input}`,
        onResponse: (response, state) => {
          state.output = response;
        }
      }
    )
  ]
});

await agent.start();
```

### Using Different Models

```typescript
import { createGeminiAction } from '@agentiny/gemini';

const advancedAnalysis = createGeminiAction(
  {
    apiKey: process.env.GOOGLE_API_KEY!,
    model: 'gemini-1.5-pro' // Use Gemini 1.5 Pro for complex tasks
  },
  {
    prompt: (state) => `Advanced analysis: ${state.data}`,
    onResponse: (response, state) => {
      state.analysis = response;
    }
  }
);
```

### With Temperature and Max Tokens

```typescript
import { createGeminiAction } from '@agentiny/gemini';

const creativeResponse = createGeminiAction(
  { apiKey: process.env.GOOGLE_API_KEY! },
  {
    prompt: (state) => `Write a creative story about: ${state.topic}`,
    onResponse: (response, state) => {
      state.story = response;
    },
    temperature: 1.0, // Creative (0-2 range)
    maxTokens: 500    // Limit response length
  }
);
```

### Chained Actions with Multiple Stages

```typescript
import { createGeminiAction } from '@agentiny/gemini';
import { Agent } from '@agentiny/core';

interface ProcessState {
  text: string;
  summary?: string;
  sentiment?: string;
}

const agent = new Agent<ProcessState>({
  initialState: { text: 'Your text here' }
});

// Stage 1: Summarize
const summarize = createGeminiAction(
  { apiKey: process.env.GOOGLE_API_KEY! },
  {
    prompt: (state) => `Summarize: ${state.text}`,
    onResponse: (response, state) => {
      state.summary = response;
    }
  }
);

// Stage 2: Analyze sentiment
const analyzeSentiment = createGeminiAction(
  { apiKey: process.env.GOOGLE_API_KEY! },
  {
    prompt: (state) => `Analyze sentiment of: ${state.summary}`,
    onResponse: (response, state) => {
      state.sentiment = response;
    }
  }
);

// First trigger: summarize when text is provided
agent.addTrigger({
  id: 'summarize-trigger',
  check: (state) => !!state.text && !state.summary,
  actions: [summarize]
});

// Second trigger: analyze after summarization
agent.addTrigger({
  id: 'analyze-trigger',
  check: (state) => !!state.summary && !state.sentiment,
  actions: [analyzeSentiment]
});

await agent.start();
```

## Model Options

Google offers several Gemini models:

- **gemini-1.5-flash** (default) - Fast and efficient, great for most tasks
- **gemini-1.5-pro** - More capable, better for complex reasoning
- **gemini-pro** - Previous generation, still available

```typescript
// Using Gemini 1.5 Pro for complex reasoning
const action = createGeminiAction(
  {
    apiKey: process.env.GOOGLE_API_KEY!,
    model: 'gemini-1.5-pro'
  },
  {
    prompt: (state) => `Analyze: ${state.data}`,
    onResponse: (response, state) => {
      state.result = response;
    }
  }
);
```

## Error Handling

Errors from the Gemini API are propagated and can be caught:

```typescript
agent.addTrigger({
  id: 'api-call',
  check: (state) => !!state.input,
  actions: [
    createGeminiAction(
      { apiKey: process.env.GOOGLE_API_KEY! },
      {
        prompt: (state) => state.input,
        onResponse: (response, state) => {
          state.output = response;
        }
      }
    )
  ]
});

// Capture errors via agent's onError callback
const agent = new Agent<TextState>({
  initialState: { input: '' },
  onError: (error) => {
    console.error('Agent error:', error.message);
  }
});
```

## Type Safety

The adapter provides full TypeScript support with type-safe state handling:

```typescript
import { createGeminiAction } from '@agentiny/gemini';
import type { ActionFn } from '@agentiny/core';

interface DataState {
  input: string;
  processed?: string;
  score?: number;
}

// TypeScript ensures prompt and onResponse match state type
const action: ActionFn<DataState> = createGeminiAction(
  { apiKey: process.env.GOOGLE_API_KEY! },
  {
    prompt: (state) => {
      // state is typed as DataState
      return `Process: ${state.input}`;
    },
    onResponse: (response, state) => {
      // state is typed as DataState
      state.processed = response;
    }
  }
);
```

## Best Practices

1. **Use environment variables for API keys** - Never hardcode secrets
2. **Choose appropriate models** - Use Flash for speed, Pro for complexity
3. **Set temperature appropriately** - Lower (0.2-0.5) for deterministic tasks, higher (0.7-2.0) for creative
4. **Set max tokens** - Use reasonable limits to control costs and response times
5. **Handle errors** - Use agent's `onError` callback for error handling
6. **Test thoroughly** - Write tests for your state transformations
7. **Monitor usage** - Track token usage to manage API costs

## Supported Features

- ✅ Full Gemini model family support
- ✅ Type-safe state handling with TypeScript
- ✅ Configurable temperature and max tokens
- ✅ Error handling and propagation
- ✅ Integration with @agentiny/core agents
- ✅ Streaming support ready

## Generating API Keys

To use the Gemini adapter, you need a Google API key:

1. Go to [Google AI Studio](https://aistudio.google.com)
2. Click "Get API Key" in the left menu
3. Create a new API key for your project
4. Store it in your `.env` file: `GOOGLE_API_KEY=your_key_here`

## License

MIT
