import type { ActionFn } from '@agentiny/core';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Google Gemini configuration
 */
export interface GeminiConfig {
  /**
   * Google API key
   */
  apiKey: string;
  /**
   * Model to use (default: gemini-1.5-flash)
   */
  model?: string;
  /**
   * Base URL for API
   */
  baseURL?: string;
}

/**
 * Options for Gemini action
 */
export interface GeminiOptions<TState = unknown> {
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
 * Creates a Gemini action for the agent
 *
 * Creates a reusable action function that calls the Google Gemini API with a message
 * generated from the agent's state. The response is passed to the onResponse
 * callback for state updates or other side effects.
 *
 * @template TState - The type of the agent's state
 * @param config - Gemini configuration including API key and optional model
 * @param options - Action options including prompt generator and response callback
 * @returns Action function that calls Gemini API and updates state via callback
 * @throws {Error} When Gemini API call fails
 *
 * @example
 * ```typescript
 * import { createGeminiAction } from '@agentiny/gemini';
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
 *     createGeminiAction(
 *       { apiKey: process.env.GOOGLE_API_KEY! },
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
export function createGeminiAction<TState = unknown>(
  config: GeminiConfig,
  options: GeminiOptions<TState>,
): ActionFn<TState> {
  return async (state: TState): Promise<void> => {
    const model = config.model ?? 'gemini-1.5-flash';
    const prompt = options.prompt(state);

    // Initialize Google Generative AI client with API key
    const client = new GoogleGenerativeAI(config.apiKey);

    // Get the generative model
    const generativeModel = client.getGenerativeModel({ model });

    // Build generation configuration
    const generationConfig: {
      maxOutputTokens?: number;
      temperature?: number;
    } = {};

    if (options.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }

    if (options.temperature !== undefined) {
      generationConfig.temperature = options.temperature;
    }

    // Call Gemini API with the prompt
    const response = await generativeModel.generateContent(prompt, {
      generationConfig:
        Object.keys(generationConfig).length > 0
          ? (generationConfig as {
              maxOutputTokens?: number;
              temperature?: number;
            })
          : undefined,
    });

    // Extract message content from response
    const messageContent = response.response.text();

    // Call the response callback with the extracted content
    options.onResponse(messageContent, state);
  };
}
