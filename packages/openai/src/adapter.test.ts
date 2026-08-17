import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActionContext } from '@agentiny/core';
import { createOpenAIAction } from './adapter';
import { assertPromptSource, buildMessages } from './messages';
import { buildResponseFormat, isZodLike, parseStructured } from './schema';
import type { OpenAICompatibleClient, OpenAIMessage } from './types';

const { MockOpenAI } = vi.hoisted(() => {
  const MockOpenAI = vi.fn(function MockOpenAI() {
    return {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
            model: 'gpt-5-nano',
          }),
        },
      },
    };
  });
  return { MockOpenAI };
});

vi.mock('openai', () => ({
  OpenAI: MockOpenAI,
}));

interface CompletionFixture {
  content?: string | null;
  finish_reason?: string | null;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  parsed?: unknown;
}

function completionResponse(fixture: CompletionFixture = {}): Record<string, unknown> {
  const message: Record<string, unknown> = {
    content: fixture.content === undefined ? 'hello' : fixture.content,
  };
  if (fixture.parsed !== undefined) {
    message.parsed = fixture.parsed;
  }

  const response: Record<string, unknown> = {
    choices: [
      {
        message,
        finish_reason: fixture.finish_reason === undefined ? 'stop' : fixture.finish_reason,
      },
    ],
    model: fixture.model ?? 'gpt-5-nano',
  };

  if (fixture.usage !== undefined) {
    response.usage = fixture.usage;
  }

  return response;
}

function mockClient(overrides?: {
  create?: ReturnType<typeof vi.fn>;
  parse?: ReturnType<typeof vi.fn> | undefined;
}): {
  client: OpenAICompatibleClient;
  create: ReturnType<typeof vi.fn>;
  parse: ReturnType<typeof vi.fn>;
} {
  const create = overrides?.create ?? vi.fn().mockResolvedValue(completionResponse());
  const parse = overrides?.parse ?? vi.fn();
  const client: OpenAICompatibleClient = {
    chat: {
      completions: {
        create,
        ...(overrides && 'parse' in overrides && overrides.parse === undefined ? {} : { parse }),
      },
    },
  };
  return { client, create, parse };
}

async function* streamOf(
  chunks: Array<Record<string, unknown>>,
): AsyncGenerator<Record<string, unknown>> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('assertPromptSource / buildMessages', () => {
  it('throws when neither prompt nor messages is set', () => {
    expect(() => assertPromptSource({})).toThrow('either `prompt` or `messages` is required');
  });

  it('throws when both prompt and messages are set', () => {
    expect(() =>
      assertPromptSource({
        prompt: () => 'x',
        messages: () => [{ role: 'user', content: 'x' }],
      }),
    ).toThrow('provide either `prompt` or `messages`, not both');
  });

  it('builds a single user message from prompt', () => {
    const messages = buildMessages({ prompt: (state: { q: string }) => state.q }, { q: 'hi' });
    expect(messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('prepends a string system message', () => {
    const messages = buildMessages({ prompt: () => 'hi', system: 'Be brief.' }, {});
    expect(messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('prepends a function system message and uses messages(state)', () => {
    const history: OpenAIMessage[] = [{ role: 'user', content: 'one' }];
    const messages = buildMessages(
      {
        messages: (state: { history: OpenAIMessage[] }) => state.history,
        system: (state: { history: OpenAIMessage[] }) => `count=${state.history.length}`,
      },
      { history },
    );
    expect(messages).toEqual([
      { role: 'system', content: 'count=1' },
      { role: 'user', content: 'one' },
    ]);
  });
});

describe('schema helpers', () => {
  it('detects Zod-like schemas', () => {
    expect(isZodLike({ safeParse: () => ({ success: true, data: 1 }) })).toBe(true);
    expect(isZodLike({ type: 'object' })).toBe(false);
    expect(isZodLike(undefined)).toBe(false);
  });

  it('builds json_schema for JSON Schema objects', () => {
    const schema = { type: 'object', properties: { n: { type: 'number' } } };
    expect(buildResponseFormat(schema, 'answer')).toEqual({
      type: 'json_schema',
      json_schema: { name: 'answer', strict: true, schema },
    });
  });

  it('builds json_object for Zod-like schemas', () => {
    expect(
      buildResponseFormat({ safeParse: () => ({ success: true, data: {} }) }, 'answer'),
    ).toEqual({
      type: 'json_object',
    });
  });

  it('parses JSON Schema payloads', () => {
    expect(parseStructured<{ n: number }>('{"n":2}', { type: 'object' })).toEqual({ n: 2 });
  });

  it('validates Zod-like payloads and throws on failure', () => {
    const schema = {
      safeParse: (data: unknown) =>
        typeof data === 'object' && data !== null && 'n' in data
          ? { success: true as const, data }
          : { success: false as const, error: 'nope' },
    };
    expect(parseStructured('{"n":1}', schema)).toEqual({ n: 1 });
    expect(() => parseStructured('{}', schema)).toThrow('response failed schema validation');
  });

  it('throws when the response is not valid JSON', () => {
    expect(() => parseStructured('not-json', { type: 'object' })).toThrow(
      'response was not valid JSON',
    );
  });
});

describe('createOpenAIAction', () => {
  beforeEach(() => {
    MockOpenAI.mockReset();
  });

  it('throws at factory time when neither prompt nor messages is set', () => {
    expect(() =>
      createOpenAIAction({
        client: mockClient().client,
        onResponse: () => undefined,
      }),
    ).toThrow('either `prompt` or `messages` is required');
  });

  it('throws at factory time when both prompt and messages are set', () => {
    expect(() =>
      createOpenAIAction({
        client: mockClient().client,
        prompt: () => 'x',
        messages: () => [{ role: 'user', content: 'x' }],
        onResponse: () => undefined,
      }),
    ).toThrow('provide either `prompt` or `messages`, not both');
  });

  it('constructs the OpenAI client once when no client is injected', async () => {
    const create = vi.fn().mockResolvedValue(completionResponse());
    MockOpenAI.mockImplementation(function MockOpenAI() {
      return {
        chat: { completions: { create } },
      };
    });

    const action = createOpenAIAction({
      apiKey: 'sk-test',
      baseURL: 'https://example.test/v1',
      prompt: () => 'hi',
      onResponse: () => undefined,
    });

    expect(MockOpenAI).toHaveBeenCalledTimes(1);
    expect(MockOpenAI).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://example.test/v1',
    });

    await action({ input: 1 });
    await action({ input: 2 });
    expect(MockOpenAI).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('uses an injected client and does not construct OpenAI', async () => {
    const { client, create } = mockClient();
    const action = createOpenAIAction({
      client,
      prompt: () => 'hi',
      onResponse: () => undefined,
    });

    await action({});
    expect(MockOpenAI).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('sends max_completion_tokens and omits temperature unless provided', async () => {
    const { client, create } = mockClient();
    const action = createOpenAIAction({
      client,
      prompt: () => 'hi',
      maxTokens: 64,
      onResponse: () => undefined,
    });

    await action({});

    const [body] = create.mock.calls[0] ?? [];
    expect(body).toMatchObject({
      model: 'gpt-5-nano',
      max_completion_tokens: 64,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('temperature');
  });

  it('forwards temperature when provided', async () => {
    const { client, create } = mockClient();
    const action = createOpenAIAction({
      client,
      prompt: () => 'hi',
      temperature: 0.2,
      onResponse: () => undefined,
    });

    await action({});
    expect(create.mock.calls[0]?.[0]).toMatchObject({ temperature: 0.2 });
  });

  it('forwards ctx.signal and omits request options when ctx is missing', async () => {
    const { client, create } = mockClient();
    const action = createOpenAIAction({
      client,
      prompt: () => 'hi',
      onResponse: () => undefined,
    });

    const controller = new AbortController();
    const ctx: ActionContext = { signal: controller.signal, triggerId: 't1' };

    await action({}, ctx);
    expect(create.mock.calls[0]?.[1]).toEqual({ signal: controller.signal });

    await action({});
    expect(create.mock.calls[1]?.[1]).toBeUndefined();
  });

  it('maps usage, finishReason, model, and raw onto onResponse', async () => {
    const response = completionResponse({
      content: 'done',
      finish_reason: 'stop',
      model: 'gpt-5-nano',
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    });
    const { client } = mockClient({
      create: vi.fn().mockResolvedValue(response),
    });

    const onResponse = vi.fn();
    const action = createOpenAIAction({
      client,
      prompt: () => 'hi',
      onResponse,
    });

    const state = { out: '' };
    await action(state);

    expect(onResponse).toHaveBeenCalledWith(
      {
        text: 'done',
        data: 'done',
        usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
        finishReason: 'stop',
        model: 'gpt-5-nano',
        raw: response,
      },
      state,
    );
  });

  it('uses an empty string when the completion has no content', async () => {
    const { client } = mockClient({
      create: vi.fn().mockResolvedValue(completionResponse({ content: null })),
    });
    const onResponse = vi.fn();
    const action = createOpenAIAction({
      client,
      prompt: () => 'hi',
      onResponse,
    });

    await action({});
    expect(onResponse.mock.calls[0]?.[0]).toMatchObject({ text: '', data: '' });
  });

  it('sends JSON Schema as response_format and parses data', async () => {
    const schema = {
      type: 'object',
      properties: { tasks: { type: 'array', items: { type: 'string' } } },
    };
    const { client, create } = mockClient({
      create: vi.fn().mockResolvedValue(completionResponse({ content: '{"tasks":["a"]}' })),
    });
    const onResponse = vi.fn();
    const action = createOpenAIAction<{ email: string }, { tasks: string[] }>({
      client,
      prompt: (state) => state.email,
      schema,
      schemaName: 'tasks',
      onResponse,
    });

    await action({ email: 'do a thing' });

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'tasks', strict: true, schema },
      },
    });
    expect(onResponse.mock.calls[0]?.[0]).toMatchObject({
      text: '{"tasks":["a"]}',
      data: { tasks: ['a'] },
    });
  });

  it('validates Zod-like schemas after create when parse is unavailable', async () => {
    const schema = {
      safeParse: (data: unknown) =>
        typeof data === 'object' && data !== null && data !== undefined && 'n' in data
          ? { success: true as const, data: data as { n: number } }
          : { success: false as const },
    };
    const { client } = mockClient({
      create: vi.fn().mockResolvedValue(completionResponse({ content: '{"n":7}' })),
      parse: undefined,
    });
    const onResponse = vi.fn();
    const action = createOpenAIAction({
      client,
      prompt: () => 'hi',
      schema,
      onResponse,
    });

    await action({});
    expect(onResponse.mock.calls[0]?.[0]).toMatchObject({ data: { n: 7 } });
  });

  it('throws when a Zod-like schema rejects the response', async () => {
    const schema = {
      safeParse: () => ({ success: false as const, error: 'bad' }),
    };
    const { client } = mockClient({
      create: vi.fn().mockResolvedValue(completionResponse({ content: '{}' })),
      parse: undefined,
    });
    const action = createOpenAIAction({
      client,
      prompt: () => 'hi',
      schema,
      onResponse: () => undefined,
    });

    await expect(action({})).rejects.toThrow('response failed schema validation');
  });

  it('throws when structured output is not valid JSON', async () => {
    const { client } = mockClient({
      create: vi.fn().mockResolvedValue(completionResponse({ content: 'nope' })),
    });
    const action = createOpenAIAction({
      client,
      prompt: () => 'hi',
      schema: { type: 'object' },
      onResponse: () => undefined,
    });

    await expect(action({})).rejects.toThrow('response was not valid JSON');
  });

  it('streams deltas and concatenates the final text', async () => {
    const { client, create } = mockClient({
      create: vi
        .fn()
        .mockResolvedValue(
          streamOf([
            { choices: [{ delta: { content: 'Hel' } }], model: 'gpt-5-nano' },
            { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] },
            { choices: [{}], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } },
          ]),
        ),
    });
    const onDelta = vi.fn();
    const onResponse = vi.fn();
    const action = createOpenAIAction({
      client,
      prompt: () => 'hi',
      onDelta,
      onResponse,
    });

    const controller = new AbortController();
    await action({}, { signal: controller.signal, triggerId: 'stream' });

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(create.mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
    expect(onDelta.mock.calls.map((call) => call[0])).toEqual(['Hel', 'lo']);
    expect(onResponse.mock.calls[0]?.[0]).toMatchObject({
      text: 'Hello',
      data: 'Hello',
      finishReason: 'stop',
      usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
    });
  });

  it('parses structured JSON after streaming', async () => {
    const { client } = mockClient({
      create: vi
        .fn()
        .mockResolvedValue(
          streamOf([
            { choices: [{ delta: { content: '{"ok":' } }] },
            { choices: [{ delta: { content: 'true}' }, finish_reason: 'stop' }] },
          ]),
        ),
    });
    const onResponse = vi.fn();
    const action = createOpenAIAction({
      client,
      prompt: () => 'hi',
      schema: { type: 'object' },
      onDelta: () => undefined,
      onResponse,
    });

    await action({});
    expect(onResponse.mock.calls[0]?.[0]).toMatchObject({
      text: '{"ok":true}',
      data: { ok: true },
    });
  });

  it('propagates SDK errors', async () => {
    const { client } = mockClient({
      create: vi.fn().mockRejectedValue(new Error('rate limited')),
    });
    const action = createOpenAIAction({
      client,
      prompt: () => 'hi',
      onResponse: () => undefined,
    });

    await expect(action({})).rejects.toThrow('rate limited');
  });

  it('propagates abort errors', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    const { client } = mockClient({
      create: vi.fn().mockRejectedValue(abortError),
    });
    const action = createOpenAIAction({
      client,
      prompt: () => 'hi',
      onResponse: () => undefined,
    });

    await expect(action({}, { signal: new AbortController().signal, triggerId: 't' })).rejects.toBe(
      abortError,
    );
  });
});
