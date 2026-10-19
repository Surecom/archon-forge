/**
 * SetupWizard — provider → credentials → model. Rendered entirely from the
 * provider's declaration (`authMethods`, `modelSelection`), so it has no
 * provider-specific branches. "Coming soon" providers are listed but disabled.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, RotateCw, ShieldCheck } from 'lucide-react';
import { listProviders, defaultProvider, getProvider } from '../providers/registry';
import { isHttpUrl } from '../providers/cursor/CursorProvider';
import {
  authMethodOf,
  missingRequiredFields,
  type AuthMethodId,
  type CredentialField,
  type LLMProvider,
  type ModelDescriptor,
  type ProviderCredentials,
} from '../providers/types';
import { useI18n } from '../i18n';
import ProviderBadge from '../ui/ProviderBadge';
import { createSettings, type ForgeSettings } from './storage';

type Step = 'provider' | 'auth' | 'model';

interface Props {
  initial: ForgeSettings | null;
  onComplete(settings: ForgeSettings): void;
  onCancel?(): void;
}

const stepsFor = (provider: LLMProvider): Step[] =>
  provider.modelSelection === 'none' ? ['provider', 'auth'] : ['provider', 'auth', 'model'];

const credentialsFor = (provider: LLMProvider, initial: ForgeSettings | null): ProviderCredentials =>
  initial?.providerId === provider.id
    ? initial.credentials
    : { authMethod: provider.authMethods[0].id, values: {} };

const fieldError = (field: CredentialField, value: string): boolean =>
  field.kind === 'url' && !!value.trim() && !isHttpUrl(value.trim());

const SetupWizard: React.FC<Props> = ({ initial, onComplete, onCancel }) => {
  const { t } = useI18n();
  const providers = listProviders();
  const [provider, setProvider] = useState<LLMProvider>(() => {
    const saved = getProvider(initial?.providerId);
    return saved?.availability === 'available' ? saved : defaultProvider();
  });
  const [credentials, setCredentials] = useState<ProviderCredentials>(() => credentialsFor(provider, initial));
  const [step, setStep] = useState<Step>('provider');
  const [model, setModel] = useState(initial?.providerId === provider.id ? initial?.model ?? '' : '');
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const steps = stepsFor(provider);
  const stepIndex = steps.indexOf(step);
  const method = authMethodOf(provider, credentials.authMethod);
  const missing = missingRequiredFields(provider, credentials);
  const invalidUrl = method.fields.some(f => fieldError(f, credentials.values[f.key] ?? ''));
  const authReady = missing.length === 0 && !invalidUrl;

  useEffect(() => {
    if (step !== 'model' || provider.modelSelection !== 'list' || !provider.listModels) return;
    const controller = new AbortController();
    setLoadingModels(true);
    setModelsError(null);
    provider.listModels(credentials, controller.signal)
      .then(list => {
        setModels(list);
        setModel(current => current || list[0]?.id || '');
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setModels([]);
        setModelsError((err as Error)?.message ?? String(err));
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingModels(false); });
    return () => controller.abort();
  }, [step, provider, credentials, reloadKey]);

  const pickProvider = (next: LLMProvider) => {
    if (next.availability !== 'available') return;
    setProvider(next);
    setCredentials(credentialsFor(next, initial));
    setModel(initial?.providerId === next.id ? initial.model ?? '' : '');
    setModels([]);
  };

  const setValue = (key: string, value: string) =>
    setCredentials(c => ({ ...c, values: { ...c.values, [key]: value } }));

  const setMethod = (id: AuthMethodId) => setCredentials(c => ({ ...c, authMethod: id }));

  const finish = () => onComplete(createSettings(provider.id, credentials, provider.modelSelection === 'none' ? undefined : model.trim()));

  const canContinue = step === 'provider' ? provider.availability === 'available'
    : step === 'auth' ? authReady
      : !!model.trim();
  const isLast = stepIndex === steps.length - 1;

  return (
    <div className="af-app">
      <div className="af-wizard__head">
        <div className="af-wizard__title">{initial ? t('wizard.editTitle') : t('wizard.title')}</div>
        <div className="af-wizard__steps" aria-label={t('wizard.step', { current: stepIndex + 1, total: steps.length })}>
          {steps.map((s, i) => (
            <span
              key={s}
              className={`af-wizard__bar${i < stepIndex ? ' af-wizard__bar--done' : i === stepIndex ? ' af-wizard__bar--current' : ''}`}
            />
          ))}
          <span>{t('wizard.step', { current: stepIndex + 1, total: steps.length })}</span>
        </div>
      </div>

      <div className="af-scroll">
        <div className="af-wizard__body">
          {step === 'provider' && (
            <section>
              <div className="af-section__title">{t('wizard.providerTitle')}</div>
              <div role="radiogroup" aria-label={t('wizard.providerTitle')}>
                {providers.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={p.id === provider.id}
                    disabled={p.availability !== 'available'}
                    className="af-option"
                    onClick={() => pickProvider(p)}
                  >
                    <ProviderBadge provider={p} size={28} />
                    <span className="af-grow">
                      <span className="af-option__name">{p.displayName}</span>
                      <br />
                      <span className="af-option__desc">{t(p.description)}</span>
                    </span>
                    {p.availability !== 'available' && <span className="af-option__tag">{t('wizard.comingSoon')}</span>}
                  </button>
                ))}
              </div>
            </section>
          )}

          {step === 'auth' && (
            <>
              <section>
                <div className="af-section__title">{t('wizard.authTitle', { provider: provider.displayName })}</div>
                {provider.authMethods.length > 1 && (
                  <div className="af-field" style={{ marginBottom: 12 }}>
                    <span className="af-field__label">{t('wizard.authMethod')}</span>
                    <div className="af-segmented" role="radiogroup" aria-label={t('wizard.authMethod')}>
                      {provider.authMethods.map(m => (
                        <button key={m.id} type="button" role="radio" aria-checked={m.id === method.id} className="af-segmented__item" onClick={() => setMethod(m.id)}>
                          {t(m.label)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {method.fields.map(field => (
                    <CredentialInput key={field.key} field={field} value={credentials.values[field.key] ?? ''} onChange={v => setValue(field.key, v)} />
                  ))}
                </div>
                {provider.docsUrl && (
                  <p className="af-field__hint" style={{ marginTop: 10 }}>
                    <a className="af-link" href={provider.docsUrl} target="_blank" rel="noreferrer">
                      {t('wizard.docs')} <ExternalLink size={11} style={{ verticalAlign: '-1px' }} />
                    </a>
                  </p>
                )}
              </section>
              <PrivacyNote />
            </>
          )}

          {step === 'model' && (
            <ModelStep
              provider={provider}
              models={models}
              loading={loadingModels}
              error={modelsError}
              value={model}
              onChange={setModel}
              onReload={() => setReloadKey(k => k + 1)}
            />
          )}
        </div>
      </div>

      <div className="af-wizard__foot">
        {onCancel ? <button type="button" className="af-btn af-btn--ghost" onClick={onCancel}>{t('wizard.cancel')}</button> : <span />}
        <div className="af-row">
          {stepIndex > 0 && (
            <button type="button" className="af-btn" onClick={() => setStep(steps[stepIndex - 1])}>{t('wizard.back')}</button>
          )}
          <button
            type="button"
            className="af-btn af-btn--primary"
            disabled={!canContinue}
            onClick={() => (isLast ? finish() : setStep(steps[stepIndex + 1]))}
          >
            {isLast ? t('wizard.save') : t('wizard.next')}
          </button>
        </div>
      </div>
    </div>
  );
};

const CredentialInput: React.FC<{ field: CredentialField; value: string; onChange(value: string): void }> = ({ field, value, onChange }) => {
  const { t } = useI18n();
  const id = `af-field-${field.key}`;
  const invalid = fieldError(field, value);
  return (
    <div className="af-field">
      <label className="af-field__label" htmlFor={id}>
        {t(field.label)}
        {field.required && <span className="af-field__required">{t('wizard.required')}</span>}
      </label>
      <input
        id={id}
        className={`af-input${invalid ? ' af-input--invalid' : ''}${field.kind !== 'text' ? ' af-mono' : ''}`}
        type={field.kind === 'secret' ? 'password' : field.kind === 'url' ? 'url' : 'text'}
        value={value}
        placeholder={field.placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        onChange={e => onChange(e.target.value)}
      />
      {field.hint && <span className="af-field__hint">{t(field.hint)}</span>}
    </div>
  );
};

interface ModelStepProps {
  provider: LLMProvider;
  models: ModelDescriptor[];
  loading: boolean;
  error: string | null;
  value: string;
  onChange(value: string): void;
  onReload(): void;
}

const ModelStep: React.FC<ModelStepProps> = ({ provider, models, loading, error, value, onChange, onReload }) => {
  const { t } = useI18n();
  const listed = useMemo(() => new Set(models.map(m => m.id)), [models]);
  return (
    <section>
      <div className="af-section__title">{t('wizard.modelTitle')}</div>
      {provider.modelSelection === 'list' && loading && (
        <div className="af-msg__thinking" role="status"><Loader2 size={14} className="af-spin" />{t('wizard.modelLoading')}</div>
      )}
      {provider.modelSelection === 'list' && error && (
        <div className="af-error" role="alert" style={{ marginBottom: 10 }}>
          <div>{t('wizard.modelLoadFailed')}</div>
          <div className="af-mono" style={{ marginTop: 4 }}>{error}</div>
          <button type="button" className="af-btn" style={{ marginTop: 8 }} onClick={onReload}>
            <RotateCw size={12} />{t('wizard.modelRetry')}
          </button>
        </div>
      )}
      {models.length > 0 && (
        <div role="radiogroup" aria-label={t('wizard.modelTitle')} style={{ marginBottom: 12 }}>
          {models.map(m => (
            <button key={m.id} type="button" role="radio" aria-checked={value === m.id} className="af-option" onClick={() => onChange(m.id)}>
              <span className="af-grow">
                <span className="af-option__name">{m.label}</span>
                {m.description && (<><br /><span className="af-option__desc">{m.description}</span></>)}
              </span>
              {m.label !== m.id && <span className="af-option__desc af-mono">{m.id}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="af-field">
        <label className="af-field__label" htmlFor="af-model-id">{t('wizard.modelManual')}</label>
        <input
          id="af-model-id"
          className="af-input af-mono"
          value={listed.has(value) ? '' : value}
          placeholder={models[0]?.id}
          onChange={e => onChange(e.target.value)}
        />
        <span className="af-field__hint">{t('wizard.modelManualHint')}</span>
      </div>
    </section>
  );
};

const PrivacyNote: React.FC = () => {
  const { t } = useI18n();
  return (
    <aside className="af-note">
      <div className="af-note__title"><ShieldCheck size={12} />{t('wizard.privacyTitle')}</div>
      <ul className="af-note__list">
        <li>{t('wizard.privacyKey')}</li>
        <li>{t('wizard.privacyBridge')}</li>
        <li>{t('wizard.privacyHistory')}</li>
      </ul>
    </aside>
  );
};

export default SetupWizard;
