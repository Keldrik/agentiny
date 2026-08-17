import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActionContext } from '@agentiny/core';
import { createAnthropicAction } from './adapter';
import { assertPromptSource, buildMessages, resolveSystem } from './messages';
import { buildOutputConfig, isZodLike, parseStructured } from './schema';
import type { AnthropicCompatibleClient, AnthropicMessage, AnthropicStreamLike } from './types';

const { MockAnthropic } = vi.hoisted(() => {
  const MockAnthropic = vi.fn(function MockAnthropic() {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'hello' }],
          stop_reason: 'end_turn',
          model: 'claude-haiku-4-5',
        }),
      },
    };
  });
  return { MockAnthropic };
});

vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: MockAnthropic,
}));

interface MessageFixture {
  texts?: string[];
  stop_reason?: string | null;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  parsed_output?: unknown;
}

function messageResponse(fixture: MessageFixture = {}): Record<string, unknown> {
  const texts = fixture.texts ?? ['hello'];
  const response: Record<string, unknown> = {
    content: texts.map((text) => ({ type: 'text', text })),
    stop_reason: fixture.stop_reason === undefined ? 'end_turn' : fixture.stop_reason,
    model: fixture.model ?? 'claude-haiku-4-5',
  };
  if (fixture.usage !== undefined) {
    response.usage = fixture.usage;
  }
  if (fixture.parsed_output !== undefined) {
    response.parsed_output = fixture.parsed_output;
  }
  return response;
}

function mockClient(overrides?: {
  create?: ReturnType<typeof vi.fn>;
  stream?: ReturnType<typeof vi.fn> | undefined;
  parse?: ReturnType<typeof vi.fn> | undefined;
}): {
  client: AnthropicCompatibleClient;
  create: ReturnType<typeof vi.fn>;
  stream: ReturnType<typeof vi.fn>;
  parse: ReturnType<typeof vi.fn>;
} {
  const create = overrides?.create ?? vi.fn().mockResolvedValue(messageResponse());
  const stream = overrides?.stream ?? vi.fn();
  const parse = overrides?.parse ?? vi.fn();
  const completions: AnthropicCompatibleClient['messages'] = { create };

  if (!(overrides && 'stream' in overrides && overrides.stream === undefined)) {
    completions.stream = stream;
  }
  if (!(overrides && 'parse' in overrides && overrides.parse === undefined)) {
    completions.parse = parse;
  }

  return {
    client: { messages: completions },
    create,
    stream,
    parse,
  };
}

function helperStream(deltas: string[], final: Record<string, unknown>): AnthropicStreamLike {
  return {
    on(event, listener) {
      if (event === 'text') {
        for (const delta of deltas) {
          listener(delta, '');
        }
      }
      return this;
    },
    async finalMessage() {
      return final;
    },
  };
}

async function* eventStream(
  events: Array<Record<string, unknown>>,
): AsyncGenerator<Record<string, unknown>> {
  for (const event of events) {
    yield event;
  }
}

describe('assertPromptSource / buildMessages / resolveSystem', () => {
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

  it('uses messages(state) as-is', () => {
    const history: AnthropicMessage[] = [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
    ];
    expect(
      buildMessages(
        { messages: (state: { history: AnthropicMessage[] }) => state.history },
        { history },
      ),
    ).toEqual(history);
  });

  it('resolves system separately and never puts it on messages', () => {
    const options = { prompt: () => 'hi', system: 'Be brief.' };
    expect(resolveSystem(options, {})).toBe('Be brief.');
    expect(buildMessages(options, {})).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('resolves a function system prompt', () => {
    expect(
      resolveSystem(
        {
          prompt: () => 'hi',
          system: (state: { name: string }) => `Hello ${state.name}`,
        },
        { name: 'Ada' },
      ),
    ).toBe('Hello Ada');
  });
});

describe('schema helpers', () => {
  it('detects Zod-like schemas', () => {
    expect(isZodLike({ safeParse: () => ({ success: true, data: 1 }) })).toBe(true);
    expect(isZodLike({ type: 'object' })).toBe(false);
    expect(isZodLike(undefined)).toBe(false);
  });

  it('builds output_config for JSON Schema objects', () => {
    const schema = { type: 'object', properties: { n: { type: 'number' } } };
    expect(buildOutputConfig(schema)).toEqual({
      format: { type: 'json_schema', schema },
    });
  });

  it('does not send output_config for Zod-like schemas', () => {
    expect(buildOutputConfig({ safeParse: () => ({ success: true, data: {} }) })).toBeUndefined();
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

describe('createAnthropicAction', () => {
  beforeEach(() => {
    MockAnthropic.mockReset();
  });

  it('throws at factory time when neither prompt nor messages is set', () => {
    expect(() =>
      createAnthropicAction({
        client: mockClient().client,
        onResponse: () => undefined,
      }),
    ).toThrow('either `prompt` or `messages` is required');
  });

  it('throws at factory time when both prompt and messages are set', () => {
    expect(() =>
      createAnthropicAction({
        client: mockClient().client,
        prompt: () => 'x',
        messages: () => [{ role: 'user', content: 'x' }],
        onResponse: () => undefined,
      }),
    ).toThrow('provide either `prompt` or `messages`, not both');
  });

  it('constructs the Anthropic client once when no client is injected', async () => {
    const create = vi.fn().mockResolvedValue(messageResponse());
    MockAnthropic.mockImplementation(function MockAnthropic() {
      return { messages: { create } };
    });

    const action = createAnthropicAction({
      apiKey: 'sk-ant-test',
      baseURL: 'https://example.test',
      prompt: () => 'hi',
      onResponse: () => undefined,
    });

    expect(MockAnthropic).toHaveBeenCalledTimes(1);
    expect(MockAnthropic).toHaveBeenCalledWith({
      apiKey: 'sk-ant-test',
      baseURL: 'https://example.test',
    });

    await action({ input: 1 });
    await action({ input: 2 });
    expect(MockAnthropic).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('uses an injected client and does not construct Anthropic', async () => {
    const { client, create } = mockClient();
    const action = createAnthropicAction({
      client,
      prompt: () => 'hi',
      onResponse: () => undefined,
    });

    await action({});
    expect(MockAnthropic).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('sends default model and max_tokens, omits temperature unless provided', async () => {
    const { client, create } = mockClient();
    const action = createAnthropicAction({
      client,
      prompt: () => 'hi',
      system: 'Be brief.',
      onResponse: () => undefined,
    });

    await action({});

    const [body] = create.mock.calls[0] ?? [];
    expect(body).toEqual({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1024,
      system: 'Be brief.',
    });
    expect(body).not.toHaveProperty('temperature');
    expect(body.messages).not.toContainEqual(expect.objectContaining({ role: 'system' }));
  });

  it('forwards temperature and overrides maxTokens', async () => {
    const { client, create } = mockClient();
    const action = createAnthropicAction({
      client,
      prompt: () => 'hi',
      temperature: 0.2,
      maxTokens: 64,
      onResponse: () => undefined,
    });

    await action({});
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      temperature: 0.2,
      max_tokens: 64,
    });
  });

  it('forwards ctx.signal and omits request options when ctx is missing', async () => {
    const { client, create } = mockClient();
    const action = createAnthropicAction({
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

  it('maps usage, stop_reason, model, concatenated text, and raw onto onResponse', async () => {
    const response = messageResponse({
      texts: ['Hel', 'lo'],
      stop_reason: 'end_turn',
      model: 'claude-haiku-4-5',
      usage: { input_tokens: 3, output_tokens: 1 },
    });
    const { client } = mockClient({
      create: vi.fn().mockResolvedValue(response),
    });
    const onResponse = vi.fn();
    const action = createAnthropicAction({
      client,
      prompt: () => 'hi',
      onResponse,
    });

    const state = { out: '' };
    await action(state);

    expect(onResponse).toHaveBeenCalledWith(
      {
        text: 'Hello',
        data: 'Hello',
        usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
        finishReason: 'end_turn',
        model: 'claude-haiku-4-5',
        raw: response,
      },
      state,
    );
  });

  it('uses an empty string when the message has no text blocks', async () => {
    const { client } = mockClient({
      create: vi.fn().mockResolvedValue({ content: [], stop_reason: 'end_turn' }),
    });
    const onResponse = vi.fn();
    const action = createAnthropicAction({
      client,
      prompt: () => 'hi',
      onResponse,
    });

    await action({});
    expect(onResponse.mock.calls[0]?.[0]).toMatchObject({ text: '', data: '' });
  });

  it('sends JSON Schema as output_config and parses data', async () => {
    const schema = {
      type: 'object',
      properties: { tasks: { type: 'array', items: { type: 'string' } } },
    };
    const { client, create } = mockClient({
      create: vi.fn().mockResolvedValue(messageResponse({ texts: ['{"tasks":["a"]}'] })),
    });
    const onResponse = vi.fn();
    const action = createAnthropicAction<{ email: string }, { tasks: string[] }>({
      client,
      prompt: (state) => state.email,
      schema,
      onResponse,
    });

    await action({ email: 'do a thing' });

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      output_config: { format: { type: 'json_schema', schema } },
    });
    expect(onResponse.mock.calls[0]?.[0]).toMatchObject({
      text: '{"tasks":["a"]}',
      data: { tasks: ['a'] },
    });
  });

  it('retries without output_config when the client rejects the field', async () => {
    const schema = { type: 'object' };
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('unknown parameter: output_config'))
      .mockResolvedValueOnce(messageResponse({ texts: ['{"ok":true}'] }));
    const { client } = mockClient({ create });
    const onResponse = vi.fn();
    const action = createAnthropicAction({
      client,
      prompt: () => 'hi',
      schema,
      onResponse,
    });

    await action({});
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[0]).not.toHaveProperty('output_config');
    expect(onResponse.mock.calls[0]?.[0]).toMatchObject({ data: { ok: true } });
  });

  it('validates Zod-like schemas after create when parse is unavailable', async () => {
    const schema = {
      safeParse: (data: unknown) =>
        typeof data === 'object' && data !== null && data !== undefined && 'n' in data
          ? { success: true as const, data: data as { n: number } }
          : { success: false as const },
    };
    const { client, create } = mockClient({
      create: vi.fn().mockResolvedValue(messageResponse({ texts: ['{"n":7}'] })),
      parse: undefined,
    });
    const onResponse = vi.fn();
    const action = createAnthropicAction({
      client,
      prompt: () => 'hi',
      schema,
      onResponse,
    });

    await action({});
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('output_config');
    expect(onResponse.mock.calls[0]?.[0]).toMatchObject({ data: { n: 7 } });
  });

  it('throws when a Zod-like schema rejects the response', async () => {
    const schema = {
      safeParse: () => ({ success: false as const, error: 'bad' }),
    };
    const { client } = mockClient({
      create: vi.fn().mockResolvedValue(messageResponse({ texts: ['{}'] })),
      parse: undefined,
    });
    const action = createAnthropicAction({
      client,
      prompt: () => 'hi',
      schema,
      onResponse: () => undefined,
    });

    await expect(action({})).rejects.toThrow('response failed schema validation');
  });

  it('throws when structured output is not valid JSON', async () => {
    const { client } = mockClient({
      create: vi.fn().mockResolvedValue(messageResponse({ texts: ['nope'] })),
    });
    const action = createAnthropicAction({
      client,
      prompt: () => 'hi',
      schema: { type: 'object' },
      onResponse: () => undefined,
    });

    await expect(action({})).rejects.toThrow('response was not valid JSON');
  });

  it('streams deltas via messages.stream and concatenates the final text', async () => {
    const final = messageResponse({
      texts: ['Hello'],
      usage: { input_tokens: 2, output_tokens: 2 },
    });
    const { client, stream, create } = mockClient({
      stream: vi.fn().mockReturnValue(helperStream(['Hel', 'lo'], final)),
    });
    const onDelta = vi.fn();
    const onResponse = vi.fn();
    const action = createAnthropicAction({
      client,
      prompt: () => 'hi',
      onDelta,
      onResponse,
    });

    const controller = new AbortController();
    await action({}, { signal: controller.signal, triggerId: 'stream' });

    expect(create).not.toHaveBeenCalled();
    expect(stream.mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
    expect(onDelta.mock.calls.map((call) => call[0])).toEqual(['Hel', 'lo']);
    expect(onResponse.mock.calls[0]?.[0]).toMatchObject({
      text: 'Hello',
      data: 'Hello',
      finishReason: 'end_turn',
      usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
    });
  });

  it('falls back to create({ stream: true }) when stream() is unavailable', async () => {
    const { client, create } = mockClient({
      stream: undefined,
      create: vi.fn().mockResolvedValue(
        eventStream([
          { type: 'message_start', message: { model: 'claude-haiku-4-5' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"ok":' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'true}' } },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 2 },
          },
        ]),
      ),
    });
    const onDelta = vi.fn();
    const onResponse = vi.fn();
    const action = createAnthropicAction({
      client,
      prompt: () => 'hi',
      schema: { type: 'object' },
      onDelta,
      onResponse,
    });

    await action({});
    expect(create.mock.calls[0]?.[0]).toMatchObject({ stream: true });
    expect(onDelta.mock.calls.map((call) => call[0])).toEqual(['{"ok":', 'true}']);
    expect(onResponse.mock.calls[0]?.[0]).toMatchObject({
      text: '{"ok":true}',
      data: { ok: true },
      finishReason: 'end_turn',
    });
  });

  it('propagates SDK errors', async () => {
    const { client } = mockClient({
      create: vi.fn().mockRejectedValue(new Error('rate limited')),
    });
    const action = createAnthropicAction({
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
    const action = createAnthropicAction({
      client,
      prompt: () => 'hi',
      onResponse: () => undefined,
    });

    await expect(action({}, { signal: new AbortController().signal, triggerId: 't' })).rejects.toBe(
      abortError,
    );
  });
});
