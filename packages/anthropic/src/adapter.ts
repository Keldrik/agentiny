import { Anthropic } from '@anthropic-ai/sdk';
import type { ActionContext, ActionFn } from '@agentiny/core';
import { assertPromptSource, buildMessages, resolveSystem } from './messages';
import { buildOutputConfig, isZodLike, parseStructured } from './schema';
import type {
  AnthropicActionOptions,
  AnthropicActionResult,
  AnthropicCompatibleClient,
  AnthropicMessageCreateRequest,
  AnthropicRequestOptions,
  AnthropicStreamLike,
  AnthropicUsage,
} from './types';

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_MAX_TOKENS = 1024;

type ActionClient = Anthropic | AnthropicCompatibleClient;

/**
 * Creates an Anthropic action for an agenTiny agent.
 *
 * The Anthropic client is created once (or taken from `options.client`) and reused
 * on every invocation. When the agent passes an `ActionContext`, its abort
 * signal is forwarded to the SDK.
 */
export function createAnthropicAction<TState = unknown, TParsed = string>(
  options: AnthropicActionOptions<TState, TParsed>,
): ActionFn<TState> {
  assertPromptSource(options);

  const client: ActionClient =
    options.client ??
    new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });

  return async (state: TState, ctx?: ActionContext): Promise<void> => {
    const model = options.model ?? DEFAULT_MODEL;
    const requestOptions = requestOptionsFrom(ctx);
    const body = buildRequestBody(options, state, model);

    if (options.onDelta !== undefined) {
      const streamResult = await completeStream(
        client,
        body,
        requestOptions,
        options.onDelta,
        state,
        model,
      );
      const result = toActionResult<TParsed>(
        streamResult.text,
        options.schema,
        streamResult.usage,
        streamResult.finishReason,
        streamResult.model,
        streamResult.raw,
        streamResult.parsed,
      );
      await options.onResponse(result, state);
      return;
    }

    if (options.schema !== undefined && isZodLike(options.schema) && hasParse(client)) {
      const parsedViaHelper = await tryParseWithZodHelper(
        client,
        body,
        requestOptions,
        options.schema,
      );

      if (parsedViaHelper !== undefined) {
        const result = toActionResult<TParsed>(
          parsedViaHelper.text,
          options.schema,
          parsedViaHelper.usage,
          parsedViaHelper.finishReason,
          parsedViaHelper.model,
          parsedViaHelper.raw,
          parsedViaHelper.parsed,
        );
        await options.onResponse(result, state);
        return;
      }
    }

    const response = await callCreate(client, body, requestOptions);
    const extracted = extractMessage(response, model);
    const result = toActionResult<TParsed>(
      extracted.text,
      options.schema,
      extracted.usage,
      extracted.finishReason,
      extracted.model,
      response,
      extracted.parsed,
    );
    await options.onResponse(result, state);
  };
}

function buildRequestBody<TState, TParsed>(
  options: AnthropicActionOptions<TState, TParsed>,
  state: TState,
  model: string,
): AnthropicMessageCreateRequest {
  const body: AnthropicMessageCreateRequest = {
    model,
    messages: buildMessages(options, state),
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
  };

  const system = resolveSystem(options, state);
  if (system !== undefined) {
    body.system = system;
  }

  if (options.temperature !== undefined) {
    body.temperature = options.temperature;
  }

  const outputConfig = buildOutputConfig(options.schema);
  if (outputConfig !== undefined) {
    body.output_config = outputConfig;
  }

  return body;
}

function requestOptionsFrom(ctx?: ActionContext): AnthropicRequestOptions | undefined {
  if (ctx?.signal === undefined) {
    return undefined;
  }
  return { signal: ctx.signal };
}

function toActionResult<TParsed>(
  text: string,
  schema: unknown,
  usage: AnthropicUsage | undefined,
  finishReason: string | null,
  model: string,
  raw: unknown,
  parsedFromApi?: unknown,
): AnthropicActionResult<TParsed> {
  const data = resolveData<TParsed>(text, schema, parsedFromApi);
  const result: AnthropicActionResult<TParsed> = {
    text,
    data,
    finishReason,
    model,
    raw,
  };

  if (usage !== undefined) {
    result.usage = usage;
  }

  return result;
}

function resolveData<TParsed>(text: string, schema: unknown, parsedFromApi: unknown): TParsed {
  if (schema === undefined) {
    return text as TParsed;
  }

  if (parsedFromApi !== undefined && parsedFromApi !== null) {
    return parsedFromApi as TParsed;
  }

  return parseStructured<TParsed>(text, schema);
}

async function tryParseWithZodHelper(
  client: ActionClient,
  body: AnthropicMessageCreateRequest,
  requestOptions: AnthropicRequestOptions | undefined,
  schema: unknown,
): Promise<ExtractedMessage | undefined> {
  if (!hasParse(client)) {
    return undefined;
  }

  let format: unknown;
  try {
    const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');
    format = zodOutputFormat(schema as never);
  } catch {
    return undefined;
  }

  const response = await callParse(client, { ...body, output_config: { format } }, requestOptions);

  return extractMessage(response, body.model);
}

interface ExtractedMessage {
  text: string;
  parsed?: unknown;
  usage?: AnthropicUsage;
  finishReason: string | null;
  model: string;
  raw: unknown;
}

function extractMessage(response: unknown, fallbackModel: string): ExtractedMessage {
  const record = asRecord(response);
  const text = collectText(record?.['content']);
  const finishReason = typeof record?.['stop_reason'] === 'string' ? record['stop_reason'] : null;
  const model = typeof record?.['model'] === 'string' ? record['model'] : fallbackModel;
  const extracted: ExtractedMessage = {
    text,
    finishReason,
    model,
    raw: response,
  };

  if (record !== undefined && 'parsed_output' in record) {
    extracted.parsed = record['parsed_output'];
  }

  const usage = mapUsage(record?.['usage']);
  if (usage !== undefined) {
    extracted.usage = usage;
  }

  return extracted;
}

function collectText(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }

  let text = '';
  for (const block of content) {
    const record = asRecord(block);
    if (record?.['type'] === 'text' && typeof record['text'] === 'string') {
      text += record['text'];
    }
  }
  return text;
}

function hasParse(client: ActionClient): client is ActionClient & {
  messages: { parse: NonNullable<AnthropicCompatibleClient['messages']['parse']> };
} {
  return typeof client.messages.parse === 'function';
}

function hasStream(client: ActionClient): client is ActionClient & {
  messages: { stream: NonNullable<AnthropicCompatibleClient['messages']['stream']> };
} {
  return typeof client.messages.stream === 'function';
}

async function callCreate(
  client: ActionClient,
  body: AnthropicMessageCreateRequest,
  requestOptions: AnthropicRequestOptions | undefined,
): Promise<unknown> {
  try {
    return await client.messages.create(body as never, requestOptions);
  } catch (error) {
    if (body.output_config !== undefined && isUnknownOutputConfigError(error)) {
      const withoutConfig: AnthropicMessageCreateRequest = {
        model: body.model,
        messages: body.messages,
        max_tokens: body.max_tokens,
      };
      if (body.system !== undefined) {
        withoutConfig.system = body.system;
      }
      if (body.temperature !== undefined) {
        withoutConfig.temperature = body.temperature;
      }
      if (body.stream !== undefined) {
        withoutConfig.stream = body.stream;
      }
      return client.messages.create(withoutConfig as never, requestOptions);
    }
    throw error;
  }
}

async function callParse(
  client: ActionClient,
  body: AnthropicMessageCreateRequest,
  requestOptions: AnthropicRequestOptions | undefined,
): Promise<unknown> {
  if (!hasParse(client)) {
    throw new Error('createAnthropicAction: client does not support messages.parse');
  }
  return client.messages.parse(body as never, requestOptions);
}

function isUnknownOutputConfigError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /output_config|output_format|unrecognized|unknown parameter|extra (field|property)/i.test(
    message,
  );
}

async function completeStream<TState>(
  client: ActionClient,
  body: AnthropicMessageCreateRequest,
  requestOptions: AnthropicRequestOptions | undefined,
  onDelta: (delta: string, state: TState) => void | Promise<void>,
  state: TState,
  fallbackModel: string,
): Promise<ExtractedMessage> {
  if (hasStream(client)) {
    return completeHelperStream(
      client.messages.stream(body, requestOptions),
      onDelta,
      state,
      fallbackModel,
    );
  }

  return completeEventStream(client, body, requestOptions, onDelta, state, fallbackModel);
}

async function completeHelperStream<TState>(
  stream: AnthropicStreamLike,
  onDelta: (delta: string, state: TState) => void | Promise<void>,
  state: TState,
  fallbackModel: string,
): Promise<ExtractedMessage> {
  let pending = Promise.resolve();

  if (typeof stream.on === 'function') {
    stream.on('text', (delta) => {
      if (typeof delta === 'string' && delta.length > 0) {
        pending = pending.then(() => onDelta(delta, state));
      }
    });
  }

  if (typeof stream.finalMessage === 'function') {
    const finalMessage = await stream.finalMessage();
    await pending;
    return extractMessage(finalMessage, fallbackModel);
  }

  if (isAsyncIterable(stream)) {
    const extracted = await consumeEventStream(stream, onDelta, state, fallbackModel);
    await pending;
    return extracted;
  }

  throw new Error('createAnthropicAction: expected a streaming response from the Anthropic client');
}

async function completeEventStream<TState>(
  client: ActionClient,
  body: AnthropicMessageCreateRequest,
  requestOptions: AnthropicRequestOptions | undefined,
  onDelta: (delta: string, state: TState) => void | Promise<void>,
  state: TState,
  fallbackModel: string,
): Promise<ExtractedMessage> {
  const response = await callCreate(client, { ...body, stream: true }, requestOptions);
  return consumeEventStream(asAsyncIterable(response), onDelta, state, fallbackModel);
}

async function consumeEventStream<TState>(
  stream: AsyncIterable<unknown>,
  onDelta: (delta: string, state: TState) => void | Promise<void>,
  state: TState,
  fallbackModel: string,
): Promise<ExtractedMessage> {
  let text = '';
  let finishReason: string | null = null;
  let model = fallbackModel;
  let usage: AnthropicUsage | undefined;
  let lastChunk: unknown;

  for await (const event of stream) {
    lastChunk = event;
    const record = asRecord(event);
    if (record === undefined) {
      continue;
    }
    const type = record['type'];

    if (type === 'content_block_delta') {
      const delta = asRecord(record['delta']);
      const piece = delta?.['text'];
      if (typeof piece === 'string' && piece.length > 0) {
        text += piece;
        await onDelta(piece, state);
      }
    }

    if (type === 'message_delta') {
      const delta = asRecord(record['delta']);
      if (typeof delta?.['stop_reason'] === 'string') {
        finishReason = delta['stop_reason'];
      }
      const deltaUsage = mapUsage(record['usage']);
      if (deltaUsage !== undefined) {
        usage = mergeUsage(usage, deltaUsage);
      }
    }

    if (type === 'message_start') {
      const message = asRecord(record['message']);
      if (typeof message?.['model'] === 'string') {
        model = message['model'];
      }
      const startUsage = mapUsage(message?.['usage']);
      if (startUsage !== undefined) {
        usage = mergeUsage(usage, startUsage);
      }
    }
  }

  const extracted: ExtractedMessage = {
    text,
    finishReason,
    model,
    raw: lastChunk,
  };

  if (usage !== undefined) {
    extracted.usage = usage;
  }

  return extracted;
}

function asAsyncIterable(value: unknown): AsyncIterable<unknown> {
  if (isAsyncIterable(value)) {
    return value;
  }

  throw new Error('createAnthropicAction: expected a streaming response from the Anthropic client');
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function mapUsage(value: unknown): AnthropicUsage | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }

  const usage: AnthropicUsage = {};
  if (typeof record['input_tokens'] === 'number') {
    usage.promptTokens = record['input_tokens'];
  }
  if (typeof record['output_tokens'] === 'number') {
    usage.completionTokens = record['output_tokens'];
  }

  if (usage.promptTokens !== undefined || usage.completionTokens !== undefined) {
    usage.totalTokens = (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  }

  if (
    usage.promptTokens === undefined &&
    usage.completionTokens === undefined &&
    usage.totalTokens === undefined
  ) {
    return undefined;
  }

  return usage;
}

function mergeUsage(current: AnthropicUsage | undefined, next: AnthropicUsage): AnthropicUsage {
  const promptTokens = next.promptTokens ?? current?.promptTokens;
  const completionTokens = next.completionTokens ?? current?.completionTokens;
  const merged: AnthropicUsage = {};
  if (promptTokens !== undefined) {
    merged.promptTokens = promptTokens;
  }
  if (completionTokens !== undefined) {
    merged.completionTokens = completionTokens;
  }
  if (promptTokens !== undefined || completionTokens !== undefined) {
    merged.totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
  }
  return merged;
}
