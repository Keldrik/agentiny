export interface ZodLikeSchema<T = unknown> {
  safeParse: (data: unknown) => { success: true; data: T } | { success: false; error?: unknown };
}

export type JsonSchemaResponseFormat = {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict: true;
    schema: unknown;
  };
};

export type JsonObjectResponseFormat = {
  type: 'json_object';
};

export type StructuredResponseFormat = JsonSchemaResponseFormat | JsonObjectResponseFormat;

export function isZodLike(schema: unknown): schema is ZodLikeSchema {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    'safeParse' in schema &&
    typeof (schema as ZodLikeSchema).safeParse === 'function'
  );
}

/**
 * Builds a Chat Completions `response_format` for structured output.
 *
 * JSON Schema objects are sent as `json_schema`. Zod-like schemas fall back to
 * `json_object` unless the caller uses `zodResponseFormat` instead.
 */
export function buildResponseFormat(
  schema: unknown,
  schemaName: string,
): StructuredResponseFormat | undefined {
  if (schema === undefined) {
    return undefined;
  }

  if (isZodLike(schema)) {
    return { type: 'json_object' };
  }

  return {
    type: 'json_schema',
    json_schema: {
      name: schemaName,
      strict: true,
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
    throw new Error(`createOpenAIAction: response was not valid JSON: ${detail}`);
  }

  if (isZodLike(schema)) {
    const result = schema.safeParse(json);
    if (!result.success) {
      throw new Error('createOpenAIAction: response failed schema validation');
    }
    return result.data as TParsed;
  }

  return json as TParsed;
}
