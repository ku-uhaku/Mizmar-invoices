'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { Icon } from '../icons';
import { Button, Checkbox, Dialog, ErrorNote, Field, Input, Select, Textarea, toast } from '../ui';

export function EmailDialog({
  documentId,
  defaultTo,
  defaultSubject,
  open,
  onClose,
}: {
  documentId: string;
  defaultTo: string;
  defaultSubject: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(
    t('Bonjour,\n\nVeuillez trouver ci-joint {document}.\n\nCordialement', {
      document: defaultSubject.toLowerCase(),
    }),
  );
  const [locale, setLocale] = useState<'FR' | 'EN' | 'AR'>('FR');
  const [attachPdf, setAttachPdf] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await api.documents.sendEmail({
          params: { id: documentId },
          body: {
            to: to
              .split(',')
              .map((address) => address.trim())
              .filter(Boolean),
            subject,
            body,
            locale,
            attachPdf,
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success(t('E-mail envoyé'));
      onClose();
      router.refresh();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Envoi impossible')),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('Envoyer par e-mail')}
      description={t('Le document est envoyé au destinataire et passe au statut « Envoyé ».')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant="primary"
            loading={send.isPending}
            disabled={!to.trim() || !subject.trim()}
            onClick={() => send.mutate()}
          >
            <Icon name="mail" />
            {t('Envoyer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>

        <Field label={t('Destinataires')} hint={t('Séparés par des virgules')} required>
          <Input value={to} onChange={(event) => setTo(event.target.value)} />
        </Field>

        <Field label={t('Objet')} required>
          <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
        </Field>

        <Field label={t('Message')}>
          <Textarea
            value={body}
            rows={6}
            onChange={(event) => setBody(event.target.value)}
            className="min-h-32"
          />
        </Field>

        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-border bg-surface-muted/50 p-3">
          <Field label={t('Langue du PDF')} className="w-full sm:w-44">
            <Select
              value={locale}
              onChange={(event) => setLocale(event.target.value as typeof locale)}
            >
              <option value="FR">Français</option>
              <option value="EN">English</option>
              <option value="AR">العربية</option>
            </Select>
          </Field>
          <Checkbox
            label={t('Joindre le PDF')}
            checked={attachPdf}
            onChange={(event) => setAttachPdf(event.target.checked)}
            className="pb-2"
          />
        </div>
      </div>
    </Dialog>
  );
}
