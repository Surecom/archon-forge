import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, Layers, Loader2, RefreshCw, RotateCw, Send, Square, XCircle } from 'lucide-react';
import type { McpBootStatus } from '../ForgePlugin';
import { useI18n, type MessageKey } from '../i18n';
import ToolCallTrace from '../ui/ToolCallTrace';
import Markdown from '../ui/Markdown';
import type { ChatMessage, UseChatSession } from './useChatSession';

interface Props {
  session: UseChatSession;
  mcpStatus: McpBootStatus;
  mcpError?: string;
  onRetryMcp(): void;
  layerName: string | null;
  readOnly: boolean;
}

const EXAMPLES: MessageKey[] = ['chat.example1', 'chat.example2', 'chat.example3'];

const placeholderKey = (mcpStatus: McpBootStatus, readOnly: boolean): MessageKey =>
  readOnly ? 'chat.placeholderViewMode'
    : mcpStatus === 'error' ? 'chat.placeholderOffline'
      : mcpStatus === 'ready' ? 'chat.placeholder'
        : 'chat.placeholderBooting';

const ChatView: React.FC<Props> = ({ session, mcpStatus, mcpError, onRetryMcp, layerName, readOnly }) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  // Sent while the worker was still booting; flushed once it is ready.
  const [queued, setQueued] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { messages, running, send } = session;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (mcpStatus === 'ready' && queued !== null && !running) {
      setQueued(null);
      void send(queued);
    }
    if (mcpStatus === 'error' && queued !== null) {
      setDraft(d => d.trim() ? d : queued);
      setQueued(null);
    }
  }, [mcpStatus, queued, running, send]);

  const composerDisabled = readOnly || mcpStatus === 'error';

  const submit = (text = draft) => {
    const value = text.trim();
    if (!value || composerDisabled || running) return;
    setDraft('');
    if (mcpStatus !== 'ready') { setQueued(value); return; }
    void send(value);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="af-app">
      <div className="af-context">
        <span className="af-chip af-grow">
          <Layers size={13} className="af-muted" />
          <span className="af-chip__label">{t('chat.layer')}:</span>
          <span className="af-truncate">{layerName ?? t('chat.layerNone')}</span>
        </span>
      </div>

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
            {queued !== null && <><br /><span className="af-muted">{t('chat.queued')}</span></>}
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
          {messages.length === 0 && (
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
            placeholder={t(placeholderKey(mcpStatus, readOnly))}
            aria-label={t(placeholderKey(mcpStatus, readOnly))}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {running ? (
            <button type="button" className="af-btn af-btn--danger" onClick={session.cancel} title={t('chat.stop')}>
              <Square size={12} />{t('chat.stop')}
            </button>
          ) : (
            <button type="button" className="af-btn af-btn--primary" onClick={() => submit()} disabled={!draft.trim() || composerDisabled} title={t('chat.send')}>
              {queued !== null ? <Loader2 size={12} className="af-spin" /> : <Send size={12} />}{t('chat.send')}
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
