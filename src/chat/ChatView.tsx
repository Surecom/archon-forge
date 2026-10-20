import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, Loader2, MessageSquarePlus, RefreshCw, RotateCw, Send, Square, Trash2, XCircle } from 'lucide-react';
import type { McpBootStatus } from '../ForgePlugin';
import { useI18n, type MessageKey } from '../i18n';
import type { LayerTab } from '../tabs/tabs';
import ToolCallTrace from '../ui/ToolCallTrace';
import Markdown from '../ui/Markdown';
import type { ChatMessage, UseChatSession } from './useChatSession';

interface Props {
  session: UseChatSession;
  /** The tab whose chat is shown; `null` = no tab open for the current layer. */
  tab: LayerTab | null;
  tabBar: React.ReactNode;
  /** Name of the tab running a turn when it is not this one. */
  otherRunningTab: string | null;
  /** Current host layer without an open tab (it was closed). */
  closedCurrentLayer: string | null;
  onOpenCurrent(): void;
  onRemoveTab(tab: LayerTab): void;
  mcpStatus: McpBootStatus;
  mcpError?: string;
  onRetryMcp(): void;
  readOnly: boolean;
}

const EXAMPLES: MessageKey[] = ['chat.example1', 'chat.example2', 'chat.example3'];

const placeholderKey = (mcpStatus: McpBootStatus, readOnly: boolean, tab: LayerTab | null): MessageKey =>
  readOnly ? 'chat.placeholderViewMode'
    : tab && !tab.available ? 'error.layerDeleted'
      : mcpStatus === 'error' ? 'chat.placeholderOffline'
        : mcpStatus === 'ready' ? 'chat.placeholder'
          : 'chat.placeholderBooting';

const ChatView: React.FC<Props> = ({
  session, tab, tabBar, otherRunningTab, closedCurrentLayer, onOpenCurrent, onRemoveTab,
  mcpStatus, mcpError, onRetryMcp, readOnly,
}) => {
  const { t } = useI18n();
  // Drafts belong to their tab, so switching layers never carries text across.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Sent while the worker was still booting; flushed in ITS tab once ready.
  const [queued, setQueued] = useState<{ key: string; text: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { messages, running, send } = session;
  const tabKey = tab?.key ?? null;
  const draft = tabKey ? drafts[tabKey] ?? '' : '';
  const setDraft = (value: string) => { if (tabKey) setDrafts(d => ({ ...d, [tabKey]: value })); };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, tabKey]);

  useEffect(() => {
    if (!queued) return;
    if (mcpStatus === 'ready' && !running && queued.key === tabKey) {
      setQueued(null);
      void send(queued.text);
    }
    if (mcpStatus === 'error') {
      setDrafts(d => ({ ...d, [queued.key]: d[queued.key]?.trim() ? d[queued.key] : queued.text }));
      setQueued(null);
    }
  }, [mcpStatus, queued, running, send, tabKey]);

  const ownRunning = !!tabKey && session.runningTabKey === tabKey;
  const composerDisabled = readOnly || mcpStatus === 'error' || !tab || !tab.available || !!otherRunningTab;

  const submit = () => {
    const value = draft.trim();
    if (!value || composerDisabled || running || !tabKey) return;
    setDraft('');
    if (mcpStatus !== 'ready') { setQueued({ key: tabKey, text: value }); return; }
    void send(value);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const queuedHere = queued !== null && queued.key === tabKey;

  return (
    <div className="af-app">
      {tabBar}

      {tab && !tab.available && (
        <div className="af-banner af-banner--warning" role="status">
          <AlertTriangle size={14} className="af-banner__icon" />
          <span className="af-grow">{t('tabs.layerDeletedBanner', { layer: tab.name })}</span>
          <button type="button" className="af-btn" onClick={() => onRemoveTab(tab)}><Trash2 size={12} />{t('tabs.remove')}</button>
        </div>
      )}
      {otherRunningTab && (
        <div className="af-banner af-banner--info" role="status">
          <Loader2 size={14} className="af-banner__icon af-spin" />
          <span>{t('tabs.otherRunning', { layer: otherRunningTab })}</span>
        </div>
      )}
      {readOnly && (
        <div className="af-banner af-banner--info" role="status">
          <Eye size={14} className="af-banner__icon" />
          <span>{t('chat.viewMode')}</span>
        </div>
      )}
      {mcpStatus === 'booting' && (
        <div className="af-banner af-banner--info" role="status">
          <Loader2 size={14} className="af-banner__icon af-spin" />
          <span className="af-grow">
            {t('chat.engineStarting')}
            {queuedHere && <><br /><span className="af-muted">{t('chat.queued')}</span></>}
          </span>
        </div>
      )}
      {mcpStatus === 'error' && (
        <div className="af-banner af-banner--danger" role="alert">
          <AlertTriangle size={14} className="af-banner__icon" />
          <span className="af-grow">
            {t('chat.engineOffline')}
            {mcpError && <><br /><span className="af-mono af-muted">{mcpError}</span></>}
          </span>
          <button type="button" className="af-btn" onClick={onRetryMcp}><RefreshCw size={12} />{t('chat.engineRetry')}</button>
        </div>
      )}

      <div ref={scrollRef} className="af-scroll">
        <div className="af-transcript" aria-live="polite">
          {!tab && (
            <div className="af-placeholder">
              {closedCurrentLayer ? (
                <>
                  <span>{t('tabs.closedCurrent', { layer: closedCurrentLayer })}</span>
                  <button type="button" className="af-btn af-btn--primary" onClick={onOpenCurrent}>
                    <MessageSquarePlus size={12} />{t('tabs.openCurrent')}
                  </button>
                </>
              ) : (
                <span>{t('tabs.noLayer')}</span>
              )}
            </div>
          )}
          {tab?.available && messages.length === 0 && (
            <div className="af-empty">
              <div className="af-empty__title">{t('chat.examplesTitle')}</div>
              {EXAMPLES.map(key => (
                <button key={key} type="button" className="af-empty__item" disabled={composerDisabled} onClick={() => setDraft(t(key))}>
                  {t(key)}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <MessageItem
              key={m.id}
              message={m}
              canRetry={session.canRetry && i === messages.length - 1}
              onRetry={() => void session.retry()}
            />
          ))}
          {session.error && <div className="af-error" role="alert">{session.error}</div>}
        </div>
      </div>

      <div className="af-composer">
        <div className="af-composer__box">
          <textarea
            className="af-textarea"
            rows={2}
            value={draft}
            disabled={composerDisabled}
            placeholder={t(placeholderKey(mcpStatus, readOnly, tab))}
            aria-label={t(placeholderKey(mcpStatus, readOnly, tab))}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {ownRunning ? (
            <button type="button" className="af-btn af-btn--danger" onClick={session.cancel} title={t('chat.stop')}>
              <Square size={12} />{t('chat.stop')}
            </button>
          ) : (
            <button type="button" className="af-btn af-btn--primary" onClick={submit} disabled={!draft.trim() || composerDisabled || running} title={t('chat.send')}>
              {queuedHere ? <Loader2 size={12} className="af-spin" /> : <Send size={12} />}{t('chat.send')}
            </button>
          )}
        </div>
        <div className="af-composer__footer">{t('chat.footer')}</div>
      </div>
    </div>
  );
};

const MessageItem: React.FC<{ message: ChatMessage; canRetry: boolean; onRetry(): void }> = ({ message, canRetry, onRetry }) => {
  const { t, tp } = useI18n();
  const isUser = message.role === 'user';
  const time = new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`af-msg${isUser ? ' af-msg--user' : ''}`}>
      <div className="af-msg__meta">
        <span className="af-msg__role">{isUser ? t('chat.roleUser') : t('chat.roleAssistant')}</span>
        <time>{time}</time>
      </div>
      {message.content && (isUser
        ? <div className="af-msg__body">{message.content}</div>
        : <Markdown text={message.content} />)}
      {message.status === 'running' && (
        <div className="af-msg__thinking" role="status">
          <Loader2 size={13} className="af-spin" />
          <span className="af-truncate">{message.thinking?.trim().split('\n').pop() || t('chat.thinking')}</span>
        </div>
      )}
      {message.tools && message.tools.length > 0 && <ToolCallTrace tools={message.tools} />}
      {message.status === 'finished' && !isUser && (
        <div className="af-status af-status--ok">
          <CheckCircle2 size={13} />
          {message.appliedCount ? tp('chat.applied', message.appliedCount) : t('chat.noChanges')}
        </div>
      )}
      {message.status === 'cancelled' && (
        <div className="af-status af-status--stopped"><Square size={12} />{t('chat.statusCancelled')}</div>
      )}
      {message.status === 'error' && (
        <div className="af-status af-status--error" role="alert"><XCircle size={13} />{message.error ?? t('chat.statusFailed')}</div>
      )}
      {canRetry && (
        <div>
          <button type="button" className="af-btn" onClick={onRetry}><RotateCw size={12} />{t('chat.retry')}</button>
        </div>
      )}
    </div>
  );
};

export default ChatView;
