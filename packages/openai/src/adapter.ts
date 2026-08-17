import { OpenAI } from 'openai';
import type { ActionContext, ActionFn } from '@agentiny/core';
import { assertPromptSource, buildMessages } from './messages';
import { buildResponseFormat, isZodLike, parseStructured } from './schema';
import type {
  ChatCompletionCreateRequest,
  ChatCompletionRequestOptions,
  OpenAIActionOptions,
  OpenAIActionResult,
  OpenAICompatibleClient,
  OpenAIUsage,
} from './types';

const DEFAULT_MODEL = 'gpt-5-nano';
const DEFAULT_SCHEMA_NAME = 'response';

type ActionClient = OpenAI | OpenAICompatibleClient;

/**
 * Creates an OpenAI action for an agenTiny agent.
 *
 * The OpenAI client is created once (or taken from `options.client`) and reused
 * on every invocation. When the agent passes an `ActionContext`, its abort
 * signal is forwarded to the SDK.
 */
export function createOpenAIAction<TState = unknown, TParsed = string>(
  options: OpenAIActionOptions<TState, TParsed>,
): ActionFn<TState> {
  assertPromptSource(options);

  const client: ActionClient =
    options.client ??
    new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });

  return async (state: TState, ctx?: ActionContext): Promise<void> => {
    const model = options.model ?? DEFAULT_MODEL;
    const schemaName = options.schemaName ?? DEFAULT_SCHEMA_NAME;
    const requestOptions = requestOptionsFrom(ctx);
    const body = buildRequestBody(options, state, model, schemaName);

    if (options.onDelta !== undefined) {
      const streamResult = await completeStream(
        client,
        { ...body, stream: true, stream_options: { include_usage: true } },
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
        schemaName,
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
    const extracted = extractCompletion(response, model);
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
  options: OpenAIActionOptions<TState, TParsed>,
  state: TState,
  model: string,
  schemaName: string,
): ChatCompletionCreateRequest {
  const body: ChatCompletionCreateRequest = {
    model,
    messages: buildMessages(options, state),
  };

  if (options.maxTokens !== undefined) {
    body.max_completion_tokens = options.maxTokens;
  }

  if (options.temperature !== undefined) {
    body.temperature = options.temperature;
  }

  const responseFormat = buildResponseFormat(options.schema, schemaName);
  if (responseFormat !== undefined) {
    body.response_format = responseFormat;
  }

  return body;
}

function requestOptionsFrom(ctx?: ActionContext): ChatCompletionRequestOptions | undefined {
  if (ctx?.signal === undefined) {
    return undefined;
  }
  return { signal: ctx.signal };
}

function toActionResult<TParsed>(
  text: string,
  schema: unknown,
  usage: OpenAIUsage | undefined,
  finishReason: string | null,
  model: string,
  raw: unknown,
  parsedFromApi?: unknown,
): OpenAIActionResult<TParsed> {
  const data = resolveData<TParsed>(text, schema, parsedFromApi);
  const result: OpenAIActionResult<TParsed> = {
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
  body: ChatCompletionCreateRequest,
  requestOptions: ChatCompletionRequestOptions | undefined,
  schema: unknown,
  schemaName: string,
): Promise<ExtractedCompletion | undefined> {
  if (!hasParse(client)) {
    return undefined;
  }

  let responseFormat: unknown;
  try {
    const { zodResponseFormat } = await import('openai/helpers/zod');
    responseFormat = zodResponseFormat(schema as never, schemaName);
  } catch {
    return undefined;
  }

  const response = await callParse(
    client,
    { ...body, response_format: responseFormat },
    requestOptions,
  );

  return extractCompletion(response, body.model);
}

interface ExtractedCompletion {
  text: string;
  parsed?: unknown;
  usage?: OpenAIUsage;
  finishReason: string | null;
  model: string;
  raw: unknown;
}

function extractCompletion(response: unknown, fallbackModel: string): ExtractedCompletion {
  const record = asRecord(response);
  const choice = firstChoice(record);
  const message = asRecord(choice?.['message']);
  const text = typeof message?.['content'] === 'string' ? message['content'] : '';
  const finishReason =
    typeof choice?.['finish_reason'] === 'string' ? choice['finish_reason'] : null;
  const model = typeof record?.['model'] === 'string' ? record['model'] : fallbackModel;
  const extracted: ExtractedCompletion = {
    text,
    finishReason,
    model,
    raw: response,
  };

  if (message !== undefined && 'parsed' in message) {
    extracted.parsed = message['parsed'];
  }

  const usage = mapUsage(record?.['usage']);
  if (usage !== undefined) {
    extracted.usage = usage;
  }

  return extracted;
}

function hasParse(client: ActionClient): client is ActionClient & {
  chat: {
    completions: { parse: NonNullable<OpenAICompatibleClient['chat']['completions']['parse']> };
  };
} {
  return typeof client.chat.completions.parse === 'function';
}

async function callCreate(
  client: ActionClient,
  body: ChatCompletionCreateRequest,
  requestOptions: ChatCompletionRequestOptions | undefined,
): Promise<unknown> {
  return client.chat.completions.create(body as never, requestOptions);
}

async function callParse(
  client: ActionClient,
  body: ChatCompletionCreateRequest,
  requestOptions: ChatCompletionRequestOptions | undefined,
): Promise<unknown> {
  if (!hasParse(client)) {
    throw new Error('createOpenAIAction: client does not support chat.completions.parse');
  }
  return client.chat.completions.parse(body as never, requestOptions);
}

async function completeStream<TState>(
  client: ActionClient,
  body: ChatCompletionCreateRequest,
  requestOptions: ChatCompletionRequestOptions | undefined,
  onDelta: (delta: string, state: TState) => void | Promise<void>,
  state: TState,
  fallbackModel: string,
): Promise<ExtractedCompletion> {
  const response = await callCreate(client, body, requestOptions);
  const stream = asAsyncIterable(response);

  let text = '';
  let finishReason: string | null = null;
  let model = fallbackModel;
  let usage: OpenAIUsage | undefined;
  let lastChunk: unknown = response;

  for await (const chunk of stream) {
    lastChunk = chunk;
    const record = asRecord(chunk);
    const choice = firstChoice(record);
    const delta = asRecord(choice?.['delta']);
    const content = delta?.['content'];

    if (typeof content === 'string' && content.length > 0) {
      text += content;
      await onDelta(content, state);
    }

    if (typeof choice?.['finish_reason'] === 'string') {
      finishReason = choice['finish_reason'];
    }

    if (typeof record?.['model'] === 'string') {
      model = record['model'];
    }

    const chunkUsage = mapUsage(record?.['usage']);
    if (chunkUsage !== undefined) {
      usage = chunkUsage;
    }
  }

  const extracted: ExtractedCompletion = {
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

  throw new Error('createOpenAIAction: expected a streaming response from the OpenAI client');
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

function firstChoice(
  record: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const choices = record?.['choices'];
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  return asRecord(choices[0]);
}

function mapUsage(value: unknown): OpenAIUsage | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }

  const usage: OpenAIUsage = {};
  if (typeof record['prompt_tokens'] === 'number') {
    usage.promptTokens = record['prompt_tokens'];
  }
  if (typeof record['completion_tokens'] === 'number') {
    usage.completionTokens = record['completion_tokens'];
  }
  if (typeof record['total_tokens'] === 'number') {
    usage.totalTokens = record['total_tokens'];
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
