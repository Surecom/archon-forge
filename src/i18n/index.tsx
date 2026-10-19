/**
 * Plugin-local i18n. The host owns the UI language (`api.getLocale`) and
 * notifies on change; Forge only maps it onto its own dictionaries, so the
 * plugin never bundles the host's i18next setup.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { en, type Dictionary, type PluralForms } from './en';
import { ru } from './ru';
import type { ArchonPluginAPI } from '../types';

export type Locale = 'en' | 'ru';

type KeysWhere<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];
export type MessageKey = KeysWhere<Dictionary, string>;
export type PluralKey = KeysWhere<Dictionary, PluralForms>;

type Params = Record<string, string | number>;

const DICTIONARIES: Record<Locale, Record<string, string | PluralForms>> = { en, ru };

const interpolate = (template: string, params?: Params): string =>
  params ? template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : template;

export interface Translator {
  locale: Locale;
  t(key: MessageKey, params?: Params): string;
  tp(key: PluralKey, count: number, params?: Params): string;
}

export function createTranslator(locale: Locale): Translator {
  const dict = DICTIONARIES[locale];
  const rules = new Intl.PluralRules(locale === 'ru' ? 'ru-RU' : 'en-US');
  return {
    locale,
    t: (key, params) => interpolate((dict[key] ?? en[key]) as string, params),
    tp: (key, count, params) => {
      const forms = (dict[key] ?? en[key]) as PluralForms;
      const category = rules.select(count) as keyof PluralForms;
      const template = forms[category] ?? forms.other ?? forms.many ?? forms.one;
      return interpolate(template, { count, ...params });
    },
  };
}

const I18nContext = createContext<Translator>(createTranslator('en'));

export const I18nProvider: React.FC<{ api: ArchonPluginAPI; children: React.ReactNode }> = ({ api, children }) => {
  const [locale, setLocale] = useState<Locale>(() => api.getLocale?.() ?? 'en');
  useEffect(() => api.subscribeToLocale?.(setLocale), [api]);
  const translator = useMemo(() => createTranslator(locale), [locale]);
  return <I18nContext.Provider value={translator}>{children}</I18nContext.Provider>;
};

export const useI18n = (): Translator => useContext(I18nContext);
