/**
 * useChatSession — React state around `runTurn`, one conversation per layer tab.
 *
 *  - every tab has its own transcript (history session = tab key) and its own
 *    provider session (agent conversation); nothing a tab sends to the model
 *    comes from another tab;
 *  - a tab's turn always edits that tab's layer, whatever the host has selected;
 *  - one turn at a time across all tabs (they share the worker); every turn gets
 *    a token, and cancel / clear bump it so late events of a stopped turn are
 *    ignored;
 *  - the turn's operations are applied once, after the provider finished, as a
 *    single undo step labelled with the user's message;
 *  - a failed or cancelled turn changes nothing and can be retried.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArchonPluginAPI } from '../types';
import type { LLMProvider, ProviderSession, ToolSchema, TranscriptMessage } from '../providers/types';
import { ProviderError } from '../providers/types';
import type { McpClient } from '../mcp/mcpClient';
import type { StateBridge } from '../mcp/stateBridge';
import type { ForgeSettings } from '../settings/storage';
import type { LayerTab } from '../tabs/tabs';
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

interface TabChat {
  messages: ChatMessage[];
  error: string | null;
  loaded: boolean;
  nextOrder: number;
}

export interface UseChatSession {
  /** Messages of the active tab. */
  messages: ChatMessage[];
  error: string | null;
  /** A turn is running in some tab (only one at a time). */
  running: boolean;
  /** Key of the tab whose turn is running. */
  runningTabKey: string | null;
  canRetry: boolean;
  send(text: string): Promise<void>;
  retry(): Promise<void>;
  cancel(): void;
  /** Deletes a tab's history and forgets its provider conversation. */
  clearTab(key: string): Promise<void>;
}

interface Args {
  api: ArchonPluginAPI;
  provider: LLMProvider | null;
  settings: ForgeSettings | null;
  mcp: McpClient | null;
  bridge: StateBridge | null;
  readOnly: boolean;
  tab: LayerTab | null;
  onAuthError(): void;
}

const EMPTY_CHAT: TabChat = { messages: [], error: null, loaded: false, nextOrder: 1 };

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
  const { api, provider, settings, mcp, bridge, readOnly, tab, onAuthError } = args;
  const { t } = useI18n();
  const [chats, setChats] = useState<Record<string, TabChat>>({});
  const [runningTabKey, setRunningTabKey] = useState<string | null>(null);
  const tokenRef = useRef(0);
  const runningRef = useRef<{ key: string; session: ProviderSession } | null>(null);
  const toolsRef = useRef<ToolSchema[] | null>(null);
  const sessionsRef = useRef(new Map<string, ProviderSession>());
  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  const patchChat = useCallback((key: string, patch: (c: TabChat) => Partial<TabChat>) => {
    setChats(all => {
      const current = all[key] ?? EMPTY_CHAT;
      return { ...all, [key]: { ...current, ...patch(current) } };
    });
  }, []);

  const patchMessage = useCallback((key: string, id: string, patch: (m: ChatMessage) => Partial<ChatMessage>) => {
    patchChat(key, c => ({ messages: c.messages.map(m => (m.id === id ? { ...m, ...patch(m) } : m)) }));
  }, [patchChat]);

  // A provider or settings change starts every tab's conversation afresh.
  useEffect(() => {
    const sessions = sessionsRef.current;
    return () => {
      sessions.forEach(s => { void s.cancel(); });
      sessions.clear();
    };
  }, [provider, settings]);

  useEffect(() => { toolsRef.current = null; }, [mcp]);

  const sessionFor = useCallback((key: string): ProviderSession | null => {
    if (!provider || !settings || provider.availability !== 'available') return null;
    const existing = sessionsRef.current.get(key);
    if (existing) return existing;
    try {
      const created = provider.createSession({ credentials: settings.credentials, model: settings.model });
      sessionsRef.current.set(key, created);
      return created;
    } catch {
      return null;
    }
  }, [provider, settings]);

  // Load a tab's history the first time it is shown.
  const tabKey = tab?.key ?? null;
  useEffect(() => {
    if (!tabKey || chatsRef.current[tabKey]?.loaded) return;
    let alive = true;
    history.loadSession(tabKey).then(rows => {
      if (!alive) return;
      patchChat(tabKey, c => c.loaded ? {} : {
        messages: rows.map(fromStored),
        loaded: true,
        nextOrder: (rows[rows.length - 1]?.order ?? 0) + 1,
      });
    }).catch(() => patchChat(tabKey, () => ({ loaded: true })));
    return () => { alive = false; };
  }, [tabKey, patchChat]);

  const execute = useCallback(async (target: LayerTab, text: string, retry: boolean) => {
    if (runningRef.current) return;
    const key = target.key;
    const fail = (message: string) => patchChat(key, () => ({ error: message }));
    const session = sessionFor(key);
    if (!provider || !settings || !session) { fail(t('error.notConfigured')); return; }
    if (!mcp || !bridge) { fail(t('error.engineNotReady')); return; }
    if (readOnly) { fail(t('error.viewMode')); return; }
    if (!target.available) { fail(t('error.layerDeleted')); return; }
    if (api.getIsAutoLayoutRunning?.()) { fail(t('error.autoLayoutRunning')); return; }

    runningRef.current = { key, session };
    setRunningTabKey(key);
    patchChat(key, () => ({ error: null }));
    const token = ++tokenRef.current;
    const isCancelled = () => tokenRef.current !== token;

    const stored = await history.loadSession(key);
    const orderBase = Math.max(chatsRef.current[key]?.nextOrder ?? 1, (stored[stored.length - 1]?.order ?? 0) + 1);
    const userOrder = orderBase;
    const assistantOrder = retry ? orderBase : orderBase + 1;
    patchChat(key, () => ({ nextOrder: assistantOrder + 1 }));

    if (!retry) {
      const userMsg: ChatMessage = { id: `user-${userOrder}`, role: 'user', content: text, ts: Date.now() };
      patchChat(key, c => ({ messages: [...c.messages, userMsg] }));
      await history.append({ sessionId: key, order: userOrder, role: 'user', content: text, ts: userMsg.ts });
    }
    const assistantId = `assistant-${assistantOrder}`;
    patchChat(key, c => ({ messages: [...c.messages, { id: assistantId, role: 'assistant', content: '', ts: Date.now(), status: 'running', tools: [] }] }));

    const finish = async (patch: Partial<ChatMessage>) => {
      patchMessage(key, assistantId, () => patch);
      await history.append({
        sessionId: key,
        order: assistantOrder,
        role: 'assistant',
        content: patch.content ?? '',
        ts: Date.now(),
        status: (patch.status ?? 'finished') as history.TurnStatus,
        appliedCount: patch.appliedCount,
      }).catch(() => undefined);
    };

    let content = '';
    try {
      if (!toolsRef.current) toolsRef.current = toModelTools(await mcp.listTools());
      const transcriptRows = retry ? stored.slice(0, stored.map(r => r.role).lastIndexOf('user')) : stored;

      const outcome = await runTurn(
        {
          systemPrompt: FORGE_SYSTEM_PROMPT,
          history: transcriptOf(transcriptRows),
          message: `${contextBlock({ name: target.name })}\n\n${text}`,
          tools: toolsRef.current,
          context: { currentLayerId: target.layerId },
          retry,
        },
        { mcp, bridge, session, isCancelled },
        {
          onText: delta => {
            if (isCancelled()) return;
            content += delta;
            patchMessage(key, assistantId, () => ({ content }));
          },
          onThinking: thinking => { if (!isCancelled()) patchMessage(key, assistantId, () => ({ thinking })); },
          onToolCall: call => { if (!isCancelled()) patchMessage(key, assistantId, m => ({ tools: [...(m.tools ?? []), call] })); },
          onToolResult: done => {
            if (!isCancelled()) patchMessage(key, assistantId, m => ({ tools: (m.tools ?? []).map(c => (c.callId === done.callId ? done : c)) }));
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
      await finish({ content: outcome.text, status: applyError ? 'error' : 'finished', appliedCount, error: applyError, thinking: undefined });
    } catch (err) {
      console.error('[archon-forge] turn failed:', err);
      if (err instanceof ProviderError && err.code === 'auth') onAuthError();
      await finish({
        content,
        status: isCancelled() ? 'cancelled' : 'error',
        error: isCancelled() ? undefined : describeError(err, t),
        thinking: undefined,
      });
    } finally {
      runningRef.current = null;
      setRunningTabKey(null);
    }
  }, [api, provider, settings, mcp, bridge, readOnly, sessionFor, onAuthError, patchChat, patchMessage, t]);

  const chat = (tabKey && chats[tabKey]) || EMPTY_CHAT;
  const messages = chat.messages;
  const running = runningTabKey !== null;
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const lastMessage = messages[messages.length - 1];
  const canRetry = !running && !!tab?.available && !!lastUser && lastMessage?.role === 'assistant'
    && (lastMessage.status === 'cancelled' || lastMessage.status === 'error');

  const send = useCallback(async (text: string) => {
    if (tab) await execute(tab, text.trim(), false);
  }, [tab, execute]);

  const retry = useCallback(async () => {
    if (!tab || !canRetry || !lastUser) return;
    patchChat(tab.key, c => ({ messages: c.messages.slice(0, -1) }));
    await execute(tab, lastUser.content, true);
  }, [tab, canRetry, lastUser, execute, patchChat]);

  const cancel = useCallback(() => {
    const active = runningRef.current;
    if (!active) return;
    tokenRef.current += 1;
    void active.session.cancel();
  }, []);

  const clearTab = useCallback(async (key: string) => {
    if (runningRef.current?.key === key) cancel();
    await history.clearSession(key);
    const session = sessionsRef.current.get(key);
    session?.reset();
    sessionsRef.current.delete(key);
    setChats(all => {
      const { [key]: _removed, ...rest } = all;
      return rest;
    });
  }, [cancel]);

  return { messages, error: chat.error, running, runningTabKey, canRetry, send, retry, cancel, clearTab };
}
