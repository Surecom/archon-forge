/**
 * Right side of the host window header: provider + model, auto layout,
 * clear history, settings. The settings cog blinks red while the
 * configuration is unusable.
 */
import React, { useEffect, useRef, useState } from 'react';
import { LayoutGrid, Loader2, Settings, Trash2 } from 'lucide-react';
import type { LLMProvider } from '../providers/types';
import type { AutoLayoutEngineId } from '../types';
import { useI18n } from '../i18n';
import ProviderBadge from './ProviderBadge';

interface Props {
  provider: LLMProvider | null;
  model?: string;
  invalid: boolean;
  booting: boolean;
  /** `undefined` = the host has no auto-layout API. */
  autoLayout?: { disabled: boolean; running: boolean; run(engine: AutoLayoutEngineId): void };
  onOpenSettings(): void;
  onClearHistory(): void;
}

const ENGINES: { id: AutoLayoutEngineId; label: 'header.autoLayoutCompact' | 'header.autoLayoutOrthogonal' }[] = [
  { id: 'compact-grid', label: 'header.autoLayoutCompact' },
  { id: 'orthogonal-flow', label: 'header.autoLayoutOrthogonal' },
];

const AutoLayoutMenu: React.FC<NonNullable<Props['autoLayout']>> = ({ disabled, running, run }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !anchorRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  const title = running ? t('header.autoLayoutRunning') : disabled ? t('header.autoLayoutViewMode') : t('header.autoLayoutTitle');
  return (
    <div className="af-menu-anchor" ref={anchorRef}>
      <button
        type="button"
        className="af-icon-btn"
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || running}
        onClick={() => setOpen(o => !o)}
      >
        {running ? <Loader2 size={14} className="af-spin" /> : <LayoutGrid size={14} />}
      </button>
      {open && (
        <div className="af-menu" role="menu">
          <div className="af-menu__title">{t('header.autoLayoutTitle')}</div>
          {ENGINES.map(engine => (
            <button
              key={engine.id}
              type="button"
              role="menuitem"
              className="af-menu__item"
              onClick={() => { setOpen(false); run(engine.id); }}
            >
              {t(engine.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const WindowHeaderSlot: React.FC<Props> = ({ provider, model, invalid, booting, autoLayout, onOpenSettings, onClearHistory }) => {
  const { t } = useI18n();
  return (
    <div className="af-root af-header">
      {provider && !invalid && (
        <span className="af-header__provider" title={model ? `${provider.displayName} · ${model}` : provider.displayName}>
          <ProviderBadge provider={provider} size={16} />
          <span className="af-truncate af-header__model">{model ?? provider.displayName}</span>
        </span>
      )}
      {booting && (
        <span className="af-header__starting" role="status">
          <Loader2 size={12} className="af-spin" />
          {t('header.starting')}
        </span>
      )}
      {autoLayout && <AutoLayoutMenu {...autoLayout} />}
      <button type="button" className="af-icon-btn" title={t('header.clearHistory')} aria-label={t('header.clearHistory')} onClick={onClearHistory}>
        <Trash2 size={14} />
      </button>
      <button
        type="button"
        className={`af-icon-btn${invalid ? ' af-icon-btn--alert' : ''}`}
        title={invalid ? t('header.settingsInvalid') : t('header.settings')}
        aria-label={invalid ? t('header.settingsInvalid') : t('header.settings')}
        onClick={onOpenSettings}
      >
        <Settings size={14} />
      </button>
    </div>
  );
};

export default WindowHeaderSlot;
