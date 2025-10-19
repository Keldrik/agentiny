# @agentiny/utils

Optional utilities for [@agentiny/core](https://github.com/Keldrik/agentiny). Provides convenient wrappers for common patterns like retry, timeout, and validation when building agent actions.

## Installation

```bash
# Install @agentiny/core and this utilities package
npm install @agentiny/core @agentiny/utils

# For Zod schema validation support
npm install zod  # optional
```

## Quick Start

```typescript
import { withRetry, withTimeout, withValidation } from '@agentiny/utils';
import { Agent } from '@agentiny/core';

interface ApiState {
  data?: string;
  error?: string;
}

const agent = new Agent<ApiState>({
  initialState: {},
});

// Create an action with retry and timeout
const fetchAction = withTimeout(
  withRetry(
    async (state) => {
      const response = await fetch('https://api.example.com/data');
      state.data = await response.text();
    },
    { attempts: 3, backoff: 'exponential', delay: 1000 },
  ),
  { ms: 5000 },
);

agent.addTrigger({
  id: 'fetch-data',
  check: (state) => !state.data && !state.error,
  actions: [fetchAction],
});

await agent.start();
```

## Utilities

### Retry

Wraps an action with automatic retry logic using exponential or linear backoff.

```typescript
import { withRetry } from '@agentiny/utils';

const action = withRetry(
  async (state) => {
    // Action that might fail
  },
  {
    attempts: 3, // Number of retry attempts
    backoff: 'exponential', // 'exponential' or 'linear' (default: 'exponential')
    delay: 1000, // Initial delay in ms (default: 1000)
  },
);
```

#### Options

- **attempts** (number, required) - Total number of attempts (including first try)
- **backoff** (string, optional) - Backoff strategy: `'linear'` or `'exponential'` (default: `'exponential'`)
- **delay** (number, optional) - Initial delay in milliseconds (default: 1000)

#### Backoff Calculation

- **Exponential**: `delay * Math.pow(2, attemptNumber)` - grows quickly (1s → 2s → 4s)
- **Linear**: `delay * (attemptNumber + 1)` - grows steadily (1s → 2s → 3s)

#### Example

```typescript
import { withRetry } from '@agentiny/utils';
import { Agent } from '@agentiny/core';

interface DownloadState {
  url: string;
  content?: string;
}

const agent = new Agent<DownloadState>({
  initialState: { url: 'https://example.com/file' },
});

agent.addTrigger({
  id: 'download',
  check: (state) => !!state.url && !state.content,
  actions: [
    withRetry(
      async (state) => {
        const response = await fetch(state.url);
        state.content = await response.text();
      },
      { attempts: 5, backoff: 'exponential', delay: 500 },
    ),
  ],
});
```

### Timeout

Wraps an action with a timeout constraint. Rejects with an error if the action exceeds the specified duration.

```typescript
import { withTimeout } from '@agentiny/utils';

const action = withTimeout(
  async (state) => {
    // Action that must complete within ms
  },
  { ms: 5000 }, // Timeout after 5 seconds
);
```

#### Options

- **ms** (number, required) - Timeout duration in milliseconds

#### Example

```typescript
import { withTimeout } from '@agentiny/utils';
import { Agent } from '@agentiny/core';

const agent = new Agent({
  initialState: {},
  onError: (error) => {
    console.error('Action timeout:', error.message);
  },
});

agent.addTrigger({
  id: 'api-call',
  check: () => true,
  actions: [
    withTimeout(
      async (state) => {
        await fetch('/api/long-running-operation');
      },
      { ms: 3000 },
    ),
  ],
});
```

### Validation

Wraps an action with state validation using a type guard function. Ensures the state matches expected shape before executing the action.

```typescript
import { withValidation, ValidationError } from '@agentiny/utils';

interface ValidState {
  name: string;
  age: number;
}

const action = withValidation(
  async (state) => {
    // state is guaranteed to be ValidState
    console.log(state.name, state.age);
  },
  {
    validate: (state): state is ValidState =>
      typeof state === 'object' &&
      state !== null &&
      'name' in state &&
      typeof (state as any).name === 'string' &&
      'age' in state &&
      typeof (state as any).age === 'number',
  },
);
```

#### Options

- **validate** (function, required) - Type guard function that returns `state is T`

#### Example

```typescript
import { withValidation, ValidationError } from '@agentiny/utils';
import { Agent } from '@agentiny/core';

interface UserState {
  userId: number;
  processed: boolean;
}

const isValidUserState = (state: unknown): state is UserState =>
  typeof state === 'object' &&
  state !== null &&
  'userId' in state &&
  typeof (state as any).userId === 'number' &&
  'processed' in state &&
  typeof (state as any).processed === 'boolean';

const agent = new Agent({
  initialState: {},
  onError: (error) => {
    if (error instanceof ValidationError) {
      console.error('Validation failed:', error.message);
    }
  },
});

agent.addTrigger({
  id: 'process-user',
  check: (state) => !isValidUserState(state),
  actions: [
    withValidation(
      async (state) => {
        console.log(`Processing user ${state.userId}`);
        state.processed = true;
      },
      { validate: isValidUserState },
    ),
  ],
});
```

### Schema Validation with Zod

Wraps an action with Zod schema validation. Provides a convenient way to validate state using Zod schemas.

```typescript
import { withSchema, ValidationError } from '@agentiny/utils';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  age: z.number().min(0).max(150),
});

const action = withSchema(async (state) => {
  // state is guaranteed to match schema
  console.log(state.email, state.age);
}, schema);
```

#### Example

```typescript
import { withSchema, ValidationError } from '@agentiny/utils';
import { z } from 'zod';
import { Agent } from '@agentiny/core';

const userSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number().positive().max(150),
});

type User = z.infer<typeof userSchema>;

const agent = new Agent<User>({
  initialState: { name: '', email: '', age: 0 },
  onError: (error) => {
    if (error instanceof ValidationError) {
      console.error('Validation error:', error.message);
      console.error('Details:', error.errors);
    }
  },
});

agent.addTrigger({
  id: 'validate-user',
  check: (state) => !!state.name && !state.email,
  actions: [
    withSchema(async (state) => {
      console.log(`User ${state.name} is valid`);
    }, userSchema),
  ],
});
```

#### Options

- **schema** (Zod schema, required) - A Zod schema for validation
- Requires `zod` to be installed as a peer dependency

#### Throws

- **ValidationError** - If validation fails or Zod is not installed

## Composing Utilities

You can combine multiple utilities to build complex action pipelines:

```typescript
import { withRetry, withTimeout, withValidation } from '@agentiny/utils';

const robustAction = withTimeout(
  withRetry(
    withValidation(
      async (state) => {
        // Validated, retried, and timed out action
      },
      { validate: isValidState },
    ),
    { attempts: 3, backoff: 'exponential' },
  ),
  { ms: 10000 },
);
```

The composition order matters - utilities are applied from inside out, so the innermost utility executes first.

## API Reference

### ValidationError

Custom error class for validation failures.

```typescript
export class ValidationError extends Error {
  constructor(message: string, errors?: unknown[]);
  readonly errors?: unknown[]; // Additional error details from validator
}
```

#### Example

```typescript
import { ValidationError } from '@agentiny/utils';

try {
  // Action that uses validation
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('Validation failed:', error.message);
    console.log('Error details:', error.errors);
  }
}
```

## Type Safety

All utilities are fully typed with TypeScript and preserve type information through the action chain:

```typescript
import { withRetry } from '@agentiny/utils';
import type { ActionFn } from '@agentiny/core';

interface State {
  data: string;
  count: number;
}

// Type is preserved through the wrapper
const action: ActionFn<State> = withRetry(
  async (state) => {
    // TypeScript knows state is State
    console.log(state.data, state.count);
  },
  { attempts: 3 },
);
```

## Error Handling

Utilities propagate errors to the agent's `onError` callback. Validation errors are wrapped in `ValidationError`:

```typescript
import { withValidation, ValidationError } from '@agentiny/utils';
import { Agent } from '@agentiny/core';

const agent = new Agent({
  initialState: {},
  onError: (error) => {
    if (error instanceof ValidationError) {
      console.error('Validation error:', error.message);
    } else {
      console.error('Action error:', error.message);
    }
  },
});
```

## Best Practices

1. **Layer utilities appropriately** - Put timeout on the outside, validation on the inside
2. **Use appropriate retry strategies** - Exponential backoff for network calls, linear for simple retries
3. **Set reasonable timeouts** - Consider action complexity and network conditions
4. **Type validate** - Use type guards with `withValidation` for compile-time safety
5. **Handle errors** - Always use agent's `onError` callback for error handling
6. **Test boundaries** - Test with both valid and invalid state to catch issues early

## Peer Dependencies

- **@agentiny/core** - Required for `ActionFn` type and agent integration

## Optional Dependencies

- **zod** - Required only if using `withSchema` for schema-based validation

## License

MIT
