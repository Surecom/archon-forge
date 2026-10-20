/**
 * Confirmation dialog owned by Forge — rendered inside the plugin window, not
 * the host's modal layer, so it never blocks the canvas or other host UI.
 * Every confirmation names exactly what it will act on (`subject`).
 */
import React, { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useI18n } from '../i18n';

export interface ConfirmSubject {
  label: string;
  value: string;
  /** Layer color for a layer subject — user data, shown as a swatch. */
  color?: string;
}

export interface ConfirmRequest {
  title: string;
  body: string;
  /** Highlighted "what exactly / where" rows. */
  subject?: ConfirmSubject[];
  /** Extra caution line, e.g. the target is not the layer on screen. */
  warning?: string;
  /** `danger` deletes data; `primary` changes the project in an undoable way. */
  tone?: 'danger' | 'primary';
  onConfirm(): void;
}

interface Props extends ConfirmRequest {
  onCancel(): void;
}

const ConfirmDialog: React.FC<Props> = ({ title, body, subject, warning, tone = 'danger', onConfirm, onCancel }) => {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button');
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    const el = dialogRef.current;
    el?.addEventListener('keydown', onKey);
    return () => el?.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="af-dialog__scrim" onPointerDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={dialogRef} className="af-dialog" role="alertdialog" aria-modal="true" aria-labelledby="af-dialog-title" aria-describedby="af-dialog-body">
        <div className="af-dialog__title" id="af-dialog-title">
          <AlertTriangle size={15} className={`af-dialog__icon af-dialog__icon--${tone}`} />
          <span>{title}</span>
        </div>
        {subject && subject.length > 0 && (
          <dl className="af-dialog__subject">
            {subject.map(row => (
              <React.Fragment key={row.label}>
                <dt>{row.label}</dt>
                <dd style={row.color ? { '--af-subject-color': row.color } as React.CSSProperties : undefined}>
                  {row.color && <span className="af-dialog__swatch" aria-hidden="true" />}
                  <strong>{row.value}</strong>
                </dd>
              </React.Fragment>
            ))}
          </dl>
        )}
        <p className="af-dialog__body" id="af-dialog-body">{body}</p>
        {warning && <p className="af-dialog__warning" role="note"><AlertTriangle size={12} />{warning}</p>}
        <div className="af-dialog__actions">
          <button ref={cancelRef} type="button" className="af-btn" onClick={onCancel}>{t('confirm.cancel')}</button>
          <button type="button" className={`af-btn af-btn--${tone}`} onClick={onConfirm}>{t('confirm.action')}</button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
