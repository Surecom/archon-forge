/**
 * One tab per integration layer. Name and tint come from the layer's own
 * color (user product data — not themed); a tab whose layer was deleted is
 * greyed out but stays open for reading until the user removes it.
 */
import React, { useEffect, useRef } from 'react';
import { Loader2, X } from 'lucide-react';
import type { LayerTab } from '../tabs/tabs';
import { useI18n } from '../i18n';

interface Props {
  tabs: LayerTab[];
  activeKey: string | null;
  runningKey: string | null;
  onSelect(key: string): void;
  onClose(tab: LayerTab): void;
}

const TabBar: React.FC<Props> = ({ tabs, activeKey, runningKey, onSelect, onClose }) => {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeKey]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const index = tabs.findIndex(tab => tab.key === activeKey);
    const next = tabs[(index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    if (next) {
      e.preventDefault();
      onSelect(next.key);
      listRef.current?.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(next.key)}"]`)?.focus();
    }
  };

  if (!tabs.length) return null;

  return (
    <div ref={listRef} className="af-tabs" role="tablist" aria-label={t('tabs.label')} onKeyDown={onKeyDown}>
      {tabs.map(tab => {
        const active = tab.key === activeKey;
        const style = { '--af-tab-color': tab.color } as React.CSSProperties;
        return (
          <div
            key={tab.key}
            className={`af-tab${active ? ' af-tab--active' : ''}${tab.available ? '' : ' af-tab--deleted'}`}
            style={style}
          >
            <button
              type="button"
              role="tab"
              data-tab-key={tab.key}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className="af-tab__main"
              title={tab.available ? tab.name : `${tab.name} — ${t('tabs.deleted')}`}
              onClick={() => onSelect(tab.key)}
            >
              <span className="af-tab__dot" aria-hidden="true" />
              <span className="af-tab__name">{tab.name}</span>
              {runningKey === tab.key && <Loader2 size={11} className="af-spin" aria-label={t('tabs.running')} />}
              {!tab.available && <span className="af-sr-only">{t('tabs.deleted')}</span>}
            </button>
            <button
              type="button"
              className="af-tab__close"
              title={t('tabs.close', { layer: tab.name })}
              aria-label={t('tabs.close', { layer: tab.name })}
              onClick={() => onClose(tab)}
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default TabBar;
