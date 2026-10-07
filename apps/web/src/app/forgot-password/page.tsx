'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthCard } from '@/components/auth-card';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

export default function ForgotPasswordPage() {
  const t = useT();
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      if (!response.ok) throw new Error('failed');
      setSent(true);
    } catch {
      setError(t('Une erreur est survenue, réessayez.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Mot de passe oublié"
      subtitle="Saisissez votre e-mail ou nom d’utilisateur ; nous vous enverrons un lien de réinitialisation."
    >
      {sent ? (
        <div className="space-y-5">
          <p className="rounded-xl border border-border bg-surface-muted p-3.5 text-sm text-ink">
            {t('Si un compte correspond, un e-mail contenant un lien de réinitialisation vient d’être envoyé. Le lien est valable 1 heure.')}
          </p>
          <Link href="/login" className="text-sm font-medium text-brand hover:underline">
            {t('Retour à la connexion')}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <Field label={t('E-mail ou nom d’utilisateur')}>
            <Input
              type="text"
              autoComplete="username"
              autoFocus
              required
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              className="h-11"
            />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" variant="primary" loading={pending} className="h-11 w-full text-[15px]">
            {t('Envoyer le lien')}
          </Button>
          <Link href="/login" className="block text-center text-sm font-medium text-brand hover:underline">
            {t('Retour à la connexion')}
          </Link>
        </form>
      )}
    </AuthCard>
  );
}
