'use client';

import type { Locale } from '@mizmar/i18n';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Card, CardHeader, PageHeader, Toggle } from '@/components/ui';
import { LOCALE_NAMES } from '@/lib/i18n/locale';
import { useLocale, useT } from '@/lib/i18n/provider';

type ThemeChoice = 'light' | 'dark' | 'system';

const THEMES: Array<{ value: ThemeChoice; label: string; bg: string; fg: string; bar: string }> = [
  { value: 'light', label: 'Clair', bg: '#f6f8f7', fg: '#ffffff', bar: '#d5ddd9' },
  { value: 'dark', label: 'Sombre', bg: '#0e1a17', fg: '#172926', bar: '#2a3f38' },
  { value: 'system', label: 'Système', bg: 'linear-gradient(90deg,#f6f8f7 50%,#0e1a17 50%)', fg: '#ffffff80', bar: '#8da39b' },
];

function readTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem('theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function ThemePicker() {
  const t = useT();
  const [theme, setTheme] = useState<ThemeChoice>('system');
  useEffect(() => setTheme(readTheme()), []);

  function choose(next: ThemeChoice) {
    setTheme(next);
    const root = document.documentElement;
    try {
      if (next === 'system') {
        localStorage.removeItem('theme');
        delete root.dataset.theme;
      } else {
        localStorage.setItem('theme', next);
        root.dataset.theme = next;
      }
    } catch {
      root.dataset.theme = next === 'system' ? '' : next;
    }
    window.dispatchEvent(new Event('mz-theme'));
  }

  return (
    <div className="grid gap-3 p-5 sm:grid-cols-3" role="radiogroup" aria-label={t('Thème')}>
      {THEMES.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={theme === option.value}
          onClick={() => choose(option.value)}
          className={clsx(
            'rounded-xl border p-3 text-start transition',
            theme === option.value
              ? 'border-brand ring-2 ring-brand/25'
              : 'border-border hover:border-border-strong',
          )}
        >
          <span
            className="mb-3 block h-20 overflow-hidden rounded-lg border border-border"
            style={{ background: option.bg }}
            aria-hidden
          >
            <span className="m-2 block h-2 w-1/2 rounded" style={{ background: option.bar }} />
            <span className="mx-2 block h-8 rounded" style={{ background: option.fg }} />
          </span>
          <span className="text-sm font-medium text-ink">{t(option.label)}</span>
        </button>
      ))}
    </div>
  );
}

export default function LanguageSettingsPage() {
  const t = useT();
  const locale = useLocale();
  const [pending, setPending] = useState<Locale | null>(null);

  async function choose(next: Locale) {
    if (next === locale) return;
    setPending(next);
    try {
      await fetch(`/api/auth/locale?locale=${next}`, { method: 'POST' });
    } finally {
      // Reload so <html lang dir> and every server-rendered string follow.
      window.location.reload();
    }
  }

  return (
    <>
      <PageHeader
        title={t('Langue & apparence')}
        subtitle={t('Préférences d’affichage de votre compte')}
      />
      <Card>
        <CardHeader
          title={t('Langue de l’interface')}
          description={t('L’arabe passe toute l’interface en lecture de droite à gauche')}
        />
        <div className="flex flex-wrap gap-2 p-5">
          {(Object.keys(LOCALE_NAMES) as Locale[]).map((code) => (
            <Toggle key={code} active={(pending ?? locale) === code} onClick={() => void choose(code)}>
              {LOCALE_NAMES[code]}
            </Toggle>
          ))}
        </div>
      </Card>
      <Card className="mt-4">
        <CardHeader
          title={t('Thème')}
          description={t('Clair, sombre, ou selon les réglages de votre appareil')}
        />
        <ThemePicker />
      </Card>
    </>
  );
}
