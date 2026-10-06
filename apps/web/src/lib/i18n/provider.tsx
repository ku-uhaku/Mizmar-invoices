'use client';

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import type { Locale } from '@mizmar/i18n';
import { setUiLocale } from '../format';
import { translateUi, type TParams } from './translate';

const LocaleContext = createContext<Locale>('FR');

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  // Set during render, not in an effect: formatters called while rendering
  // children must already see the right locale on the first pass.
  setUiLocale(locale);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/**
 * `t('Nouveau client')`: French is the source text and doubles as the key, so a
 * string that has no translation yet still reads correctly instead of showing a
 * raw key.
 */
export function useT(): (fr: string, params?: TParams) => string {
  const locale = useContext(LocaleContext);
  return useCallback((fr, params) => translateUi(locale, fr, params), [locale]);
}
