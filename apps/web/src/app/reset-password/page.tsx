'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthCard } from '@/components/auth-card';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

function ResetForm() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t('Les mots de passe ne correspondent pas.'));
      return;
    }
    setPending(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { code?: string };
        setError(
          body.code === 'INVALID_RESET_TOKEN'
            ? t('Ce lien est invalide ou a expiré. Demandez-en un nouveau.')
            : t('Une erreur est survenue, réessayez.'),
        );
        return;
      }
      setDone(true);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-5">
        <p className="rounded-xl border border-border bg-surface-muted p-3.5 text-sm text-ink">
          {t('Mot de passe mis à jour. Vous pouvez maintenant vous connecter.')}
        </p>
        <Link href="/login" className="text-sm font-medium text-brand hover:underline">
          {t('Se connecter')}
        </Link>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="space-y-5">
        <ErrorNote>{t('Ce lien est invalide ou a expiré. Demandez-en un nouveau.')}</ErrorNote>
        <Link href="/forgot-password" className="text-sm font-medium text-brand hover:underline">
          {t('Mot de passe oublié')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label={t('Nouveau mot de passe')} hint={t('8 caractères minimum')}>
        <Input
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-11"
        />
      </Field>
      <Field label={t('Confirmer le mot de passe')}>
        <Input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          className="h-11"
        />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" variant="primary" loading={pending} className="h-11 w-full text-[15px]">
        {t('Réinitialiser le mot de passe')}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Nouveau mot de passe" subtitle="Choisissez un nouveau mot de passe pour votre compte.">
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </AuthCard>
  );
}
