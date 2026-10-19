/**
 * Provider contract — the only thing the chat engine knows about a model
 * backend. A provider declares how it authenticates and whether it has models
 * to pick from; the setup wizard renders itself from that declaration, so a
 * new provider is one folder plus one registry line.
 *
 * Messages are provider-neutral: tool calls carry their own `callId`, results
 * are matched by it. Each provider maps that onto its wire format (OpenAI
 * `tool_call_id`, Anthropic `tool_use` blocks, Cursor custom tools, …).
 */
import type { MessageKey } from '../i18n';

export type ProviderAvailability = 'available' | 'coming-soon';

/** How the wizard shows the model step. */
export type ModelSelection = 'list' | 'manual' | 'none';

export type CredentialFieldKind = 'secret' | 'text' | 'url';

export interface CredentialField {
  key: string;
  kind: CredentialFieldKind;
  label: MessageKey;
  hint?: MessageKey;
  placeholder?: string;
  required: boolean;
}

export type AuthMethodId = 'apiKey' | 'loginPassword';

export interface AuthMethod {
  id: AuthMethodId;
  label: MessageKey;
  fields: CredentialField[];
}

export interface ProviderCredentials {
  authMethod: AuthMethodId;
  values: Record<string, string>;
}

export interface ModelDescriptor {
  id: string;
  label: string;
  description?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface TurnRequest {
  systemPrompt: string;
  /** Earlier completed turns, oldest first. */
  history: TranscriptMessage[];
  /** This turn's message, including the host context block. */
  message: string;
  tools: ToolSchema[];
  /** Re-run of the previous turn after a failure or cancel. */
  retry?: boolean;
}

export type RunStatus = 'finished' | 'cancelled' | 'error';

export type ProviderEvent =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_call'; callId: string; name: string; args: Record<string, unknown> }
  | { kind: 'done'; status: RunStatus; text?: string };

export interface ToolResult {
  callId: string;
  text: string;
  isError: boolean;
}

/**
 * One conversation with a provider. `run` yields events; for a `tool_call`
 * the engine executes the tool and resumes the generator with its result.
 */
export interface ProviderSession {
  run(request: TurnRequest): AsyncGenerator<ProviderEvent, void, ToolResult | undefined>;
  /** Stops the current run. Safe to call when nothing is running. */
  cancel(): Promise<void>;
  /** Forgets provider-side conversation state (after "clear history"). */
  reset(): void;
}

export interface LLMProvider {
  id: string;
  displayName: string;
  description: MessageKey;
  /** Brand identity — not themed. */
  brandColor: string;
  /** Short monogram shown in the provider badge. */
  monogram: string;
  availability: ProviderAvailability;
  authMethods: AuthMethod[];
  modelSelection: ModelSelection;
  docsUrl?: string;
  listModels?(credentials: ProviderCredentials, signal?: AbortSignal): Promise<ModelDescriptor[]>;
  createSession(options: { credentials: ProviderCredentials; model?: string }): ProviderSession;
}

export type ProviderErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'busy'
  | 'network'
  | 'server'
  | 'not_implemented'
  | 'unknown';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, code: ProviderErrorCode, options: { retryable?: boolean; status?: number } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = options.retryable ?? (code === 'network' || code === 'server' || code === 'rate_limit' || code === 'busy');
    this.status = options.status;
  }
}

export const authMethodOf = (provider: LLMProvider, id: AuthMethodId | undefined): AuthMethod =>
  provider.authMethods.find(m => m.id === id) ?? provider.authMethods[0];

/** Generic required-field check; providers with extra rules wrap it. */
export function missingRequiredFields(provider: LLMProvider, credentials: ProviderCredentials | undefined): CredentialField[] {
  const method = authMethodOf(provider, credentials?.authMethod);
  return method.fields.filter(f => f.required && !(credentials?.values[f.key] ?? '').trim());
}
