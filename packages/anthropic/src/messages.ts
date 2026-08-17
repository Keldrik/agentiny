import type { AnthropicActionOptions, AnthropicMessage } from './types';

type PromptSource<TState> = Pick<AnthropicActionOptions<TState>, 'prompt' | 'messages' | 'system'>;

/**
 * @throws {Error} When both or neither of `prompt` and `messages` are set.
 */
export function assertPromptSource<TState>(options: PromptSource<TState>): void {
  if (options.prompt !== undefined && options.messages !== undefined) {
    throw new Error('createAnthropicAction: provide either `prompt` or `messages`, not both');
  }

  if (options.prompt === undefined && options.messages === undefined) {
    throw new Error('createAnthropicAction: either `prompt` or `messages` is required');
  }
}

/**
 * Resolves the top-level Messages API `system` field. Never put this on `messages`.
 */
export function resolveSystem<TState>(
  options: PromptSource<TState>,
  state: TState,
): string | undefined {
  if (options.system === undefined) {
    return undefined;
  }
  return typeof options.system === 'function' ? options.system(state) : options.system;
}

/**
 * Builds the Messages API `messages` array (`user` / `assistant` only).
 *
 * @throws {Error} When both or neither of `prompt` and `messages` are set.
 */
export function buildMessages<TState>(
  options: PromptSource<TState>,
  state: TState,
): AnthropicMessage[] {
  assertPromptSource(options);

  if (options.messages !== undefined) {
    return options.messages(state);
  }

  if (options.prompt === undefined) {
    throw new Error('createAnthropicAction: either `prompt` or `messages` is required');
  }

  return [
    {
      role: 'user',
      content: options.prompt(state),
    },
  ];
}
