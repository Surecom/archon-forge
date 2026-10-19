/**
 * Cursor provider — talks to the ArchON bridge (`/api/forge/cursor/*`), which
 * runs a Cursor SDK agent server-side. The SDK needs Node, so it cannot run in
 * the browser; the bridge registers every archon-mcp tool as an SDK custom tool
 * and relays each call back here over the run's event stream. The tools
 * themselves still execute in this browser's worker.
 *
 * Wire protocol (see resume/helpers/forgeCursorBridge.ts):
 *   GET  /models                        → { models: ModelDescriptor[] }
 *   POST /runs                          → text/event-stream:
 *        started {runId} · text {text} · thinking {text}
 *        tool_call {callId, name, args} · done {status, agentId, text?} · error {message, code, retryable}
 *   POST /runs/{runId}/tool-result      {callId, text, isError}
 *   POST /runs/{runId}/cancel
 * Every request carries `Authorization: Bearer <Cursor API key>`.
 */
import {
  LLMProvider,
  ModelDescriptor,
  ProviderCredentials,
  ProviderError,
  ProviderErrorCode,
  ProviderEvent,
  ProviderSession,
  ToolResult,
  TurnRequest,
} from '../types';
import { readSse } from '../sse';

const BRIDGE_PATH = '/api/forge/cursor';

export function resolveDefaultBridgeUrl(): string {
  const host = typeof window !== 'undefined' ? window.location?.hostname ?? '' : '';
  const local = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
  return `${local ? 'http://localhost:80' : 'https://surecom.in'}${BRIDGE_PATH}`;
}

export const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

interface BridgeConfig {
  baseUrl: string;
  apiKey: string;
}

function bridgeConfig(credentials: ProviderCredentials): BridgeConfig {
  const apiKey = (credentials.values.apiKey ?? '').trim();
  if (!apiKey) throw new ProviderError('Missing Cursor API key', 'auth', { retryable: false });
  const custom = (credentials.values.bridgeUrl ?? '').trim();
  return { apiKey, baseUrl: (custom || resolveDefaultBridgeUrl()).replace(/\/+$/, '') };
}

const authHeaders = (cfg: BridgeConfig): Record<string, string> => ({ Authorization: `Bearer ${cfg.apiKey}` });

const codeForStatus = (status: number): ProviderErrorCode =>
  status === 401 || status === 403 ? 'auth'
    : status === 409 ? 'busy'
      : status === 429 ? 'rate_limit'
        : status >= 500 ? 'server'
          : 'unknown';

async function errorFromResponse(res: Response): Promise<ProviderError> {
  const body = await res.json().catch(() => null) as { message?: string; error?: string; retryable?: boolean } | null;
  const message = body?.message || body?.error || `${res.status} ${res.statusText}`;
  return new ProviderError(message, codeForStatus(res.status), { status: res.status, retryable: body?.retryable });
}

async function bridgeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ProviderError((err as Error)?.message || 'Network error', 'network');
  }
}

async function listModels(credentials: ProviderCredentials, signal?: AbortSignal): Promise<ModelDescriptor[]> {
  const cfg = bridgeConfig(credentials);
  const res = await bridgeFetch(`${cfg.baseUrl}/models`, { headers: authHeaders(cfg), signal });
  if (!res.ok) throw await errorFromResponse(res);
  const { models } = await res.json() as { models: ModelDescriptor[] };
  return models;
}

const parse = <T,>(data: string): T => JSON.parse(data) as T;

class CursorSession implements ProviderSession {
  private agentId: string | null = null;
  private runId: string | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly cfg: BridgeConfig, private readonly model: string | undefined) {}

  async *run(request: TurnRequest): AsyncGenerator<ProviderEvent, void, ToolResult | undefined> {
    const controller = new AbortController();
    this.controller = controller;
    try {
      const res = await bridgeFetch(`${this.cfg.baseUrl}/runs`, {
        method: 'POST',
        headers: { ...authHeaders(this.cfg), 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          model: this.model,
          agentId: this.agentId,
          retry: !!request.retry,
          systemPrompt: request.systemPrompt,
          history: request.history,
          message: request.message,
          tools: request.tools,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw await errorFromResponse(res);

      for await (const message of readSse(res.body)) {
        switch (message.event) {
          case 'started':
            this.runId = parse<{ runId: string }>(message.data).runId;
            break;
          case 'text':
            yield { kind: 'text', text: parse<{ text: string }>(message.data).text };
            break;
          case 'thinking':
            yield { kind: 'thinking', text: parse<{ text: string }>(message.data).text };
            break;
          case 'tool_call': {
            const call = parse<{ callId: string; name: string; args: Record<string, unknown> }>(message.data);
            const result = yield { kind: 'tool_call', callId: call.callId, name: call.name, args: call.args ?? {} };
            if (!controller.signal.aborted) {
              await this.postToolResult(result ?? { callId: call.callId, text: 'No result', isError: true });
            }
            break;
          }
          case 'done': {
            const done = parse<{ status: 'finished' | 'cancelled' | 'error'; agentId?: string; text?: string }>(message.data);
            if (done.agentId) this.agentId = done.agentId;
            yield { kind: 'done', status: done.status, text: done.text };
            return;
          }
          case 'error': {
            const failure = parse<{ message: string; code?: ProviderErrorCode; retryable?: boolean }>(message.data);
            throw new ProviderError(failure.message, failure.code ?? 'unknown', { retryable: failure.retryable });
          }
          default:
            break;
        }
      }
      if (!controller.signal.aborted) throw new ProviderError('The bridge closed the stream before the run finished', 'network');
      yield { kind: 'done', status: 'cancelled' };
    } catch (err) {
      if (controller.signal.aborted) {
        yield { kind: 'done', status: 'cancelled' };
        return;
      }
      throw err;
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        this.runId = null;
      }
    }
  }

  async cancel(): Promise<void> {
    const runId = this.runId;
    this.controller?.abort();
    if (!runId) return;
    await fetch(`${this.cfg.baseUrl}/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
      headers: authHeaders(this.cfg),
    }).catch(() => undefined);
  }

  reset(): void {
    this.agentId = null;
  }

  private async postToolResult(result: ToolResult): Promise<void> {
    if (!this.runId) return;
    const res = await bridgeFetch(`${this.cfg.baseUrl}/runs/${encodeURIComponent(this.runId)}/tool-result`, {
      method: 'POST',
      headers: { ...authHeaders(this.cfg), 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
    if (!res.ok) throw await errorFromResponse(res);
  }
}

export const cursorProvider: LLMProvider = {
  id: 'cursor',
  displayName: 'Cursor',
  description: 'provider.cursor.description',
  brandColor: '#6b7cff',
  monogram: 'C',
  availability: 'available',
  docsUrl: 'https://cursor.com/docs/sdk/typescript',
  modelSelection: 'list',
  authMethods: [{
    id: 'apiKey',
    label: 'auth.apiKey',
    fields: [
      { key: 'apiKey', kind: 'secret', label: 'field.apiKey', hint: 'field.cursorApiKeyHint', placeholder: 'key_…', required: true },
      { key: 'bridgeUrl', kind: 'url', label: 'field.bridgeUrl', hint: 'field.bridgeUrlHint', required: false },
    ],
  }],
  listModels,
  createSession: ({ credentials, model }) => new CursorSession(bridgeConfig(credentials), model),
};
