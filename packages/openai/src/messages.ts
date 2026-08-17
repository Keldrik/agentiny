import type { OpenAIActionOptions, OpenAIMessage } from './types';

type PromptSource<TState> = Pick<OpenAIActionOptions<TState>, 'prompt' | 'messages' | 'system'>;

/**
 * @throws {Error} When both or neither of `prompt` and `messages` are set.
 */
export function assertPromptSource<TState>(options: PromptSource<TState>): void {
  if (options.prompt !== undefined && options.messages !== undefined) {
    throw new Error('createOpenAIAction: provide either `prompt` or `messages`, not both');
  }

  if (options.prompt === undefined && options.messages === undefined) {
    throw new Error('createOpenAIAction: either `prompt` or `messages` is required');
  }
}

/**
 * Builds the Chat Completions message list from action options and the current state.
 *
 * @throws {Error} When both or neither of `prompt` and `messages` are set.
 */
export function buildMessages<TState>(
  options: PromptSource<TState>,
  state: TState,
): OpenAIMessage[] {
  assertPromptSource(options);

  const messages: OpenAIMessage[] = [];

  if (options.system !== undefined) {
    const content = typeof options.system === 'function' ? options.system(state) : options.system;
    messages.push({ role: 'system', content });
  }

  if (options.messages !== undefined) {
    messages.push(...options.messages(state));
    return messages;
  }

  if (options.prompt === undefined) {
    throw new Error('createOpenAIAction: either `prompt` or `messages` is required');
  }

  messages.push({
    role: 'user',
    content: options.prompt(state),
  });

  return messages;
}
