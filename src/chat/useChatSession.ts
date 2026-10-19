/**
 * useChatSession — React state around `runTurn`.
 *
 *  - one turn at a time; every turn gets a token, and cancel / clear bump it so
 *    late events of a stopped turn are ignored;
 *  - the turn's operations are applied once, after the provider finished, as a
 *    single undo step labelled with the user's message;
 *  - a failed or cancelled turn changes nothing and can be retried.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArchonPluginAPI } from '../types';
import type { LLMProvider, ProviderSession, ToolSchema, TranscriptMessage } from '../providers/types';
import { ProviderError } from '../providers/types';
import type { McpClient } from '../mcp/mcpClient';
import type { StateBridge } from '../mcp/stateBridge';
import type { ForgeSettings } from '../settings/storage';
import { useI18n, type Translator } from '../i18n';
import * as history from './historyStore';
import { FORGE_SYSTEM_PROMPT, contextBlock } from './systemPrompt';
import { runTurn, type ToolTrace } from './turnEngine';
import { toModelTools } from './tools';
import { countChanges } from './changes';

export type MessageStatus = 'running' | 'finished' | 'cancelled' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  status?: MessageStatus;
  thinking?: string;
  tools?: ToolTrace[];
  appliedCount?: number;
  error?: string;
}

export interface UseChatSession {
  messages: ChatMessage[];
  running: boolean;
  error: string | null;
  canRetry: boolean;
  send(text: string): Promise<void>;
  retry(): Promise<void>;
  cancel(): void;
  clear(): Promise<void>;
}

interface Args {
  api: ArchonPluginAPI;
  provider: LLMProvider | null;
  settings: ForgeSettings | null;
  mcp: McpClient | null;
  bridge: StateBridge | null;
  readOnly: boolean;
  selectedLayerId: string | null;
  onAuthError(): void;
}

const LABEL_LENGTH = 60;
const undoLabel = (text: string): string => {
  const line = text.trim().split('\n')[0];
  return `Forge: ${line.length > LABEL_LENGTH ? `${line.slice(0, LABEL_LENGTH - 1)}…` : line}`;
};

/** Completed exchanges only — a failed turn must not steer the next one. */
function transcriptOf(rows: history.StoredMessage[]): TranscriptMessage[] {
  return rows.flatMap((row, i) => {
    const next = rows[i + 1];
    if (row.role !== 'user' || next?.role !== 'assistant' || next.status !== 'finished') return [];
    return [{ role: 'user' as const, text: row.content }, { role: 'assistant' as const, text: next.content }];
  });
}

function describeError(err: unknown, t: Translator['t']): string {
  if (err instanceof ProviderError) {
    if (err.code === 'auth') return t('error.auth');
    if (err.code === 'network') return t('error.network', { reason: err.message });
    if (err.code === 'busy') return t('error.busy');
    if (err.code === 'not_implemented') return t('error.notImplemented');
  }
  return t('error.unknown', { reason: (err as Error)?.message ?? String(err) });
}

const fromStored = (row: history.StoredMessage): ChatMessage => ({
  id: `${row.role}-${row.order}`,
  role: row.role,
  content: row.content,
  ts: row.ts,
  status: row.status,
  appliedCount: row.appliedCount,
});

export function useChatSession(args: Args): UseChatSession {
  const { api, provider, settings, mcp, bridge, readOnly, selectedLayerId, onAuthError } = args;
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);
  const orderRef = useRef(1);
  const runningRef = useRef(false);
  const toolsRef = useRef<ToolSchema[] | null>(null);

  const session = useMemo<ProviderSession | null>(() => {
    if (!provider || !settings || provider.availability !== 'available') return null;
    try {
      return provider.createSession({ credentials: settings.credentials, model: settings.model });
    } catch {
      return null;
    }
  }, [provider, settings]);

  useEffect(() => () => { void session?.cancel(); }, [session]);
  useEffect(() => { toolsRef.current = null; }, [mcp]);

  useEffect(() => {
    let alive = true;
    history.loadSession().then(rows => {
      if (!alive) return;
      orderRef.current = (rows[rows.length - 1]?.order ?? 0) + 1;
      setMessages(rows.map(fromStored));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const patchMessage = useCallback((id: string, patch: (m: ChatMessage) => Partial<ChatMessage>) => {
    setMessages(list => list.map(m => (m.id === id ? { ...m, ...patch(m) } : m)));
  }, []);

  const execute = useCallback(async (text: string, retry: boolean) => {
    if (runningRef.current) return;
    if (!provider || !settings || !session) { setError(t('error.notConfigured')); return; }
    if (!mcp || !bridge) { setError(t('error.engineNotReady')); return; }
    if (readOnly) { setError(t('error.viewMode')); return; }
    if (api.getIsAutoLayoutRunning?.()) { setError(t('error.autoLayoutRunning')); return; }

    runningRef.current = true;
    setRunning(true);
    setError(null);
    const token = ++tokenRef.current;
    const isCancelled = () => tokenRef.current !== token;

    const stored = await history.loadSession();
    if (!retry) {
      const userOrder = orderRef.current++;
      const userMsg: ChatMessage = { id: `user-${userOrder}`, role: 'user', content: text, ts: Date.now() };
      setMessages(list => [...list, userMsg]);
      await history.append({ sessionId: history.DEFAULT_SESSION_ID, order: userOrder, role: 'user', content: text, ts: userMsg.ts });
    }
    const assistantOrder = orderRef.current++;
    const assistantId = `assistant-${assistantOrder}`;
    setMessages(list => [...list, { id: assistantId, role: 'assistant', content: '', ts: Date.now(), status: 'running', tools: [] }]);

    const finish = async (patch: Partial<ChatMessage>) => {
      patchMessage(assistantId, () => patch);
      const status = (patch.status ?? 'finished') as history.TurnStatus;
      await history.append({
        sessionId: history.DEFAULT_SESSION_ID,
        order: assistantOrder,
        role: 'assistant',
        content: patch.content ?? '',
        ts: Date.now(),
        status,
        appliedCount: patch.appliedCount,
      }).catch(() => undefined);
    };

    let content = '';
    try {
      if (!toolsRef.current) toolsRef.current = toModelTools(await mcp.listTools());
      const layer = selectedLayerId ? api.getProjectState().integrationLayers?.[selectedLayerId] ?? null : null;
      const transcriptRows = retry ? stored.slice(0, stored.map(r => r.role).lastIndexOf('user')) : stored;

      const outcome = await runTurn(
        {
          systemPrompt: FORGE_SYSTEM_PROMPT,
          history: transcriptOf(transcriptRows),
          message: `${contextBlock(layer)}\n\n${text}`,
          tools: toolsRef.current,
          context: { currentLayerId: layer ? selectedLayerId : null },
          retry,
        },
        { mcp, bridge, session, isCancelled },
        {
          onText: delta => {
            if (isCancelled()) return;
            content += delta;
            patchMessage(assistantId, () => ({ content }));
          },
          onThinking: thinking => { if (!isCancelled()) patchMessage(assistantId, () => ({ thinking })); },
          onToolCall: call => { if (!isCancelled()) patchMessage(assistantId, m => ({ tools: [...(m.tools ?? []), call] })); },
          onToolResult: done => {
            if (!isCancelled()) patchMessage(assistantId, m => ({ tools: (m.tools ?? []).map(c => (c.callId === done.callId ? done : c)) }));
          },
        },
      );

      if (outcome.status !== 'finished') {
        await finish({ content: outcome.text, status: outcome.status === 'cancelled' ? 'cancelled' : 'error', thinking: undefined });
        return;
      }

      let appliedCount = 0;
      let applyError: string | undefined;
      if (outcome.operations.length) {
        try {
          await api.applyMcpOperations(outcome.operations, undoLabel(text));
          appliedCount = countChanges(outcome.operations);
        } catch (err) {
          applyError = t('chat.applyFailed', { reason: (err as Error)?.message ?? String(err) });
        }
      }
      await finish({
        content: outcome.text,
        status: applyError ? 'error' : 'finished',
        appliedCount,
        error: applyError,
        thinking: undefined,
      });
    } catch (err) {
      console.error('[archon-forge] turn failed:', err);
      if (err instanceof ProviderError && err.code === 'auth') onAuthError();
      const message = describeError(err, t);
      await finish({ content, status: isCancelled() ? 'cancelled' : 'error', error: isCancelled() ? undefined : message, thinking: undefined });
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [api, provider, settings, session, mcp, bridge, readOnly, selectedLayerId, onAuthError, patchMessage, t]);

  const send = useCallback((text: string) => execute(text.trim(), false), [execute]);

  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const lastAssistant = messages[messages.length - 1];
  const canRetry = !running && !!lastUser && lastAssistant?.role === 'assistant'
    && (lastAssistant.status === 'cancelled' || lastAssistant.status === 'error');

  const retry = useCallback(async () => {
    if (!canRetry || !lastUser) return;
    setMessages(list => list.slice(0, -1));
    await execute(lastUser.content, true);
  }, [canRetry, lastUser, execute]);

  const cancel = useCallback(() => {
    if (!runningRef.current) return;
    tokenRef.current += 1;
    void session?.cancel();
  }, [session]);

  const clear = useCallback(async () => {
    cancel();
    await history.clearSession();
    session?.reset();
    orderRef.current = 1;
    setMessages([]);
    setError(null);
  }, [cancel, session]);

  return { messages, running, error, canRetry, send, retry, cancel, clear };
}
