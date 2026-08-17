export interface ZodLikeSchema<T = unknown> {
  safeParse: (data: unknown) => { success: true; data: T } | { success: false; error?: unknown };
}

export type AnthropicOutputConfig = {
  format: {
    type: 'json_schema';
    schema: unknown;
  };
};

export function isZodLike(schema: unknown): schema is ZodLikeSchema {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    'safeParse' in schema &&
    typeof (schema as ZodLikeSchema).safeParse === 'function'
  );
}

/**
 * Builds Messages API `output_config` for JSON Schema structured output.
 *
 * Zod-like schemas have no JSON Schema to send unless the caller uses
 * `zodOutputFormat` on `messages.parse`.
 */
export function buildOutputConfig(schema: unknown): AnthropicOutputConfig | undefined {
  if (schema === undefined || isZodLike(schema)) {
    return undefined;
  }

  return {
    format: {
      type: 'json_schema',
      schema,
    },
  };
}

/**
 * Parses model text into structured data. Zod-like schemas are validated with `safeParse`.
 *
 * @throws {Error} When the text is not valid JSON, or when `safeParse` fails.
 */
export function parseStructured<TParsed>(text: string, schema: unknown): TParsed {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`createAnthropicAction: response was not valid JSON: ${detail}`);
  }

  if (isZodLike(schema)) {
    const result = schema.safeParse(json);
    if (!result.success) {
      throw new Error('createAnthropicAction: response failed schema validation');
    }
    return result.data as TParsed;
  }

  return json as TParsed;
}
