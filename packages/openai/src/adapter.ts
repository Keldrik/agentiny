import type { ActionFn } from '@agentiny/core';

// Type-only import for the OpenAI class to support proper TypeScript checking
type OpenAIType = typeof import('openai').OpenAI;

/**
 * OpenAI configuration
 */
export interface OpenAIConfig {
  /**
   * OpenAI API key
   */
  apiKey: string;
  /**
   * Model to use (default: gpt-5-nano-2025-08-07)
   */
  model?: string;
  /**
   * Base URL for API
   */
  baseURL?: string;
}

/**
 * Options for OpenAI action
 */
export interface OpenAIOptions<TState = unknown> {
  /**
   * Function to generate prompt from state
   */
  prompt: (state: TState) => string;
  /**
   * Callback when response is received
   */
  onResponse: (response: string, state: TState) => void;
  /**
   * Maximum tokens in response
   */
  maxTokens?: number;
  /**
   * Temperature for model (0-2)
   */
  temperature?: number;
}

/**
 * Creates an OpenAI action for the agent
 *
 * Creates a reusable action function that calls the OpenAI API with a message
 * generated from the agent's state. The response is passed to the onResponse
 * callback for state updates or other side effects.
 *
 * @template TState - The type of the agent's state
 * @param config - OpenAI configuration including API key and optional model/baseURL
 * @param options - Action options including prompt generator and response callback
 * @returns Action function that calls OpenAI API and updates state via callback
 * @throws {Error} When OpenAI API call fails
 *
 * @example
 * ```typescript
 * import { createOpenAIAction } from '@agentiny/openai';
 * import { Agent } from '@agentiny/core';
 *
 * interface AnalysisState {
 *   data: string;
 *   analysis?: string;
 * }
 *
 * const agent = new Agent<AnalysisState>({ initialState: { data: '' } });
 *
 * agent.addTrigger({
 *   id: 'analyze',
 *   check: (state) => !!state.data && !state.analysis,
 *   actions: [
 *     createOpenAIAction(
 *       { apiKey: process.env.OPENAI_API_KEY! },
 *       {
 *         prompt: (state) => `Analyze this data: ${state.data}`,
 *         onResponse: (response, state) => {
 *           state.analysis = response;
 *         }
 *       }
 *     )
 *   ]
 * });
 * ```
 */
export function createOpenAIAction<TState = unknown>(
  config: OpenAIConfig,
  options: OpenAIOptions<TState>,
): ActionFn<TState> {
  return async (state: TState): Promise<void> => {
    // Dynamic import to handle module resolution in different environments
    const { OpenAI } = (await import('openai')) as { OpenAI: OpenAIType };

    const model = config.model ?? 'gpt-5-nano-2025-08-07';
    const prompt = options.prompt(state);

    // Initialize OpenAI client with provided configuration
    const clientConfig: { apiKey: string; baseURL?: string } = {
      apiKey: config.apiKey,
    };

    if (config.baseURL !== undefined) {
      clientConfig.baseURL = config.baseURL;
    }

    const client = new OpenAI(clientConfig);

    // Build request parameters
    const requestParams: {
      model: string;
      messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
      max_tokens?: number;
      temperature?: number;
    } = {
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    };

    // Add optional parameters if provided
    if (options.maxTokens !== undefined) {
      requestParams.max_tokens = options.maxTokens;
    }

    if (options.temperature !== undefined) {
      requestParams.temperature = options.temperature;
    }

    // Call OpenAI API
    const response = await client.chat.completions.create(requestParams);

    // Extract message content from response
    const messageContent = response.choices[0]?.message.content ?? '';

    // Call the response callback with the extracted content
    options.onResponse(messageContent, state);
  };
}
