/**
 * Providers that are declared but not implemented yet. They show up in the
 * wizard as disabled entries, and their auth/model declarations are final, so
 * implementing one means replacing `createSession` (and adding `listModels`)
 * without touching the wizard, the storage or the chat engine.
 *
 * DeepSeek and ChatGPT share the OpenAI chat-completions wire format with
 * client-side tool calls; Claude Code uses Anthropic `tool_use` blocks; the
 * on-prem entry targets any OpenAI-compatible server behind custom auth.
 */
import { AuthMethod, LLMProvider, ProviderError, ProviderSession } from './types';

const notImplementedSession = (name: string): ProviderSession => ({
  // eslint-disable-next-line require-yield
  async *run() {
    throw new ProviderError(`${name} is not available yet`, 'not_implemented', { retryable: false });
  },
  cancel: async () => undefined,
  reset: () => undefined,
});

const apiKeyAuth = (withBaseUrl: boolean): AuthMethod => ({
  id: 'apiKey',
  label: 'auth.apiKey',
  fields: [
    { key: 'apiKey', kind: 'secret', label: 'field.apiKey', required: true },
    ...(withBaseUrl ? [{ key: 'baseUrl', kind: 'url' as const, label: 'field.baseUrl' as const, hint: 'field.baseUrlHint' as const, required: true }] : []),
  ],
});

const loginPasswordAuth: AuthMethod = {
  id: 'loginPassword',
  label: 'auth.loginPassword',
  fields: [
    { key: 'baseUrl', kind: 'url', label: 'field.baseUrl', hint: 'field.baseUrlHint', required: true },
    { key: 'username', kind: 'text', label: 'field.username', required: true },
    { key: 'password', kind: 'secret', label: 'field.password', required: true },
  ],
};

const comingSoon = (provider: Omit<LLMProvider, 'availability' | 'createSession'>): LLMProvider => ({
  ...provider,
  availability: 'coming-soon',
  createSession: () => notImplementedSession(provider.displayName),
});

export const deepSeekProvider = comingSoon({
  id: 'deepseek',
  displayName: 'DeepSeek',
  description: 'provider.deepseek.description',
  brandColor: '#4d6bfe',
  monogram: 'D',
  docsUrl: 'https://api-docs.deepseek.com/',
  modelSelection: 'list',
  authMethods: [apiKeyAuth(false)],
});

export const chatGptProvider = comingSoon({
  id: 'chatgpt',
  displayName: 'ChatGPT',
  description: 'provider.chatgpt.description',
  brandColor: '#10a37f',
  monogram: 'G',
  docsUrl: 'https://platform.openai.com/docs/api-reference',
  modelSelection: 'list',
  authMethods: [apiKeyAuth(false)],
});

export const claudeCodeProvider = comingSoon({
  id: 'claude-code',
  displayName: 'Claude Code',
  description: 'provider.claudeCode.description',
  brandColor: '#d97757',
  monogram: 'A',
  docsUrl: 'https://docs.anthropic.com/',
  modelSelection: 'list',
  authMethods: [apiKeyAuth(false)],
});

export const onPremProvider = comingSoon({
  id: 'onprem',
  displayName: 'On-prem LLM',
  description: 'provider.onprem.description',
  brandColor: '#64748b',
  monogram: 'O',
  modelSelection: 'manual',
  authMethods: [apiKeyAuth(true), loginPasswordAuth],
});
