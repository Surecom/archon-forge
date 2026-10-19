import React, { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Loader2, Wrench } from 'lucide-react';
import type { ToolTrace } from '../chat/turnEngine';
import { useI18n } from '../i18n';

const RESULT_PREVIEW = 600;

const ToolCallTrace: React.FC<{ tools: ToolTrace[] }> = ({ tools }) => {
  const { t, tp } = useI18n();
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  const failed = tools.filter(c => c.isError).length;

  return (
    <div className="af-trace">
      <button type="button" className="af-trace__toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Wrench size={12} />
        {tp('chat.toolCalls', tools.length)}
        {failed > 0 && <span className="af-status--error">· {failed} {t('chat.toolError')}</span>}
      </button>
      {open && (
        <ol className="af-trace__list">
          {tools.map(call => (
            <li key={call.callId} className="af-trace__item">
              <div className={`af-trace__name${call.isError ? ' af-trace__name--error' : ''}`}>
                {call.result === undefined ? <Loader2 size={11} className="af-spin" /> : call.isError ? <AlertCircle size={11} /> : null}
                <span className="af-truncate">{call.name}({JSON.stringify(call.args)})</span>
              </div>
              {call.result && (
                <div className="af-trace__result">
                  {call.result.length > RESULT_PREVIEW ? `${call.result.slice(0, RESULT_PREVIEW)}…` : call.result}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default ToolCallTrace;
