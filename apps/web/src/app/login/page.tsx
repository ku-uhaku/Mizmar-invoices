'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Icon } from '@/components/icons';
import { LOCALES } from '@mizmar/i18n';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { LOCALE_NAMES } from '@/lib/i18n/locale';
import { useLocale, useT } from '@/lib/i18n/provider';

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reveal, setReveal] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: email, password }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      setError(body.message ?? t('Identifiant ou mot de passe incorrect.'));
      setPending(false);
      return;
    }

    // A full navigation, so the server components pick up the new cookies.
    window.location.href = params.get('next') ?? '/dashboard';
  }

  const DEMOS = [
    { label: 'Propriétaire', email: 'owner@mizmar.ma' },
    { label: 'Comptable', email: 'accountant@mizmar.ma' },
    { label: 'Commercial', email: 'sales@mizmar.ma' },
    { label: 'Magasinier', email: 'warehouse@mizmar.ma' },
  ];

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label={t('E-mail ou nom d’utilisateur')}>
        <Input
          type="text"
          autoComplete="username"
          autoFocus
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="vous@entreprise.ma"
          className="h-11"
        />
      </Field>

      <Field label={t('Mot de passe')}>
        <div className="relative">
          <Input
            type={reveal ? 'text' : 'password'}
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t('Votre mot de passe')}
            className="h-11 pe-16"
          />
          <button
            type="button"
            onClick={() => setReveal((value) => !value)}
            className="absolute end-1.5 top-1/2 h-8 -translate-y-1/2 rounded-md px-2.5 text-xs font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
          >
            {reveal ? t('Masquer') : t('Afficher')}
          </button>
        </div>
      </Field>

      <div className="-mt-2 text-end">
        <Link href="/forgot-password" className="text-xs font-medium text-brand hover:underline">
          {t('Mot de passe oublié ?')}
        </Link>
      </div>

      <ErrorNote>{error}</ErrorNote>

      <Button type="submit" variant="primary" loading={pending} className="h-11 w-full text-[15px]">
        {t('Se connecter')}
      </Button>

      <div className="rounded-xl border border-dashed border-border-strong p-3.5">
        <p className="mb-2 text-xs font-medium text-ink-muted">{t('Compte de démonstration')}</p>
        <div className="flex flex-wrap gap-1.5">
          {DEMOS.map((demo) => (
            <button
              key={demo.email}
              type="button"
              onClick={() => {
                setEmail(demo.email);
                setPassword('Mizmar2026!');
              }}
              className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-ink hover:border-brand hover:text-brand"
            >
              {t(demo.label)}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}

const POINTS = [
  { icon: 'invoice', text: 'Du devis à l’avoir, chaque document suit son cycle.' },
  { icon: 'warehouse', text: 'Stock par dépôt, mis à jour à chaque validation.' },
  { icon: 'printer', text: 'PDF en français, anglais ou arabe, à votre image.' },
] as const;

export default function LoginPage() {
  const t = useT();
  const locale = useLocale();
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-6 flex justify-end gap-1" role="group" aria-label={t('Langue')}>
            {LOCALES.map((code) => (
              <button
                key={code}
                type="button"
                title={LOCALE_NAMES[code]}
                aria-pressed={code === locale}
                onClick={async () => {
                  await fetch(`/api/auth/locale?locale=${code}`, { method: 'POST' });
                  window.location.reload();
                }}
                className={`h-7 rounded-md px-2.5 text-xs font-semibold ${code === locale ? 'bg-brand text-white dark:text-canvas' : 'text-ink-muted hover:bg-surface-muted'}`}
              >
                {code}
              </button>
            ))}
          </div>
          <div className="mb-10 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-brand text-lg font-bold text-white shadow-sm dark:text-canvas">
              M
            </div>
            <span className="text-lg font-semibold tracking-tight text-ink">Mizmar</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-ink">{t('Bon retour')}</h1>
          <p className="mb-8 mt-2 text-[15px] text-ink-muted">
            {t('Connectez-vous pour gérer vos documents et votre stock.')}
          </p>

          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </section>

      <aside className="relative hidden overflow-hidden bg-side p-12 text-side-ink lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="absolute -end-32 -top-32 size-120 rounded-full bg-brand/25 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-40 -start-20 size-96 rounded-full bg-brand/15 blur-3xl"
        />

        <p className="relative text-sm font-medium text-side-muted">{t('Facturation · Stock · Documents')}</p>

        <div className="relative">
          <h2 className="max-w-md text-4xl font-semibold leading-tight tracking-tight">
            {t('Toute votre activité commerciale, au même endroit.')}
          </h2>
          <ul className="mt-8 space-y-4">
            {POINTS.map((point) => (
              <li key={point.text} className="flex items-start gap-3 text-[15px] text-side-muted">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-side-raised text-brand">
                  <Icon name={point.icon} />
                </span>
                <span className="pt-1">{t(point.text)}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-side-muted/70">© Mizmar</p>
      </aside>
    </main>
  );
}
