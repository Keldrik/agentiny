import type { ActionFn } from '@agentiny/core';
import { Anthropic } from '@anthropic-ai/sdk';

/**
 * Anthropic configuration
 */
export interface AnthropicConfig {
  /**
   * Anthropic API key
   */
  apiKey: string;
  /**
   * Model to use (default: claude-3-haiku-20240307)
   */
  model?: string;
  /**
   * Base URL for API
   */
  baseURL?: string;
}

/**
 * Options for Anthropic action
 */
export interface AnthropicOptions<TState = unknown> {
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
   * Temperature for model (0-1)
   */
  temperature?: number;
}

/**
 * Creates an Anthropic action for the agent
 *
 * Creates a reusable action function that calls the Anthropic API with a message
 * generated from the agent's state. The response is passed to the onResponse
 * callback for state updates or other side effects.
 *
 * @template TState - The type of the agent's state
 * @param config - Anthropic configuration including API key and optional model/baseURL
 * @param options - Action options including prompt generator and response callback
 * @returns Action function that calls Anthropic API and updates state via callback
 * @throws {Error} When Anthropic API call fails
 *
 * @example
 * ```typescript
 * import { createAnthropicAction } from '@agentiny/anthropic';
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
 *     createAnthropicAction(
 *       { apiKey: process.env.ANTHROPIC_API_KEY! },
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
export function createAnthropicAction<TState = unknown>(
  config: AnthropicConfig,
  options: AnthropicOptions<TState>
): ActionFn<TState> {
  return async (state: TState): Promise<void> => {
    const model = config.model ?? 'claude-3-haiku-20240307';
    const prompt = options.prompt(state);

    // Initialize Anthropic client with provided configuration
    const clientConfig: { apiKey: string; baseURL?: string } = {
      apiKey: config.apiKey,
    };

    if (config.baseURL !== undefined) {
      clientConfig.baseURL = config.baseURL;
    }

    const client = new Anthropic(clientConfig);

    // Build request parameters
    const requestParams: {
      model: string;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      max_tokens: number;
      temperature?: number;
    } = {
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: options.maxTokens ?? 1024,
    };

    // Add optional temperature if provided
    if (options.temperature !== undefined) {
      requestParams.temperature = options.temperature;
    }

    // Call Anthropic API
    const response = await client.messages.create(requestParams);

    // Extract message content from response
    let messageContent = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        messageContent += block.text;
      }
    }

    // Call the response callback with the extracted content
    options.onResponse(messageContent, state);
  };
}
