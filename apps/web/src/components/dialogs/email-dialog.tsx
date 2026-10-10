'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, apiModules, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { useWhatsappEnabled } from '@/lib/whatsapp';
import { Icon } from '../icons';
import { Button, Checkbox, Dialog, ErrorNote, Field, Input, Select, Textarea, toast } from '../ui';

export function EmailDialog({
  documentId,
  contactId,
  channel,
  defaultTo,
  defaultSubject,
  open,
  onClose,
}: {
  documentId: string;
  /** The customer; their saved e-mail and phone prefill the recipients. */
  contactId: string;
  /** One dialog per channel, so each has its own button on the document page. */
  channel: 'EMAIL' | 'WHATSAPP';
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

  const whatsappEnabled = useWhatsappEnabled();
  const [phone, setPhone] = useState('');
  const [savePhone, setSavePhone] = useState(true);
  const [prefilled, setPrefilled] = useState(false);

  const contact = useQuery({
    queryKey: ['contact', contactId],
    queryFn: async () => unwrap(await api.contacts.get({ params: { id: contactId } })),
    enabled: open,
  });
  const savedPhone = contact.data?.phone?.trim() || contact.data?.phone2?.trim() || '';

  // Prefill once, so typing is never overwritten by a late response.
  useEffect(() => {
    if (!contact.data || prefilled) return;
    setPrefilled(true);
    setPhone(savedPhone);
    if (!to.trim() && contact.data.email) setTo(contact.data.email);
  }, [contact.data, prefilled, savedPhone, to]);

  const emailTo = to
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  const isWhatsapp = channel === 'WHATSAPP';
  const sendEmail = !isWhatsapp && emailTo.length > 0;
  const sendWhatsapp = isWhatsapp && whatsappEnabled;

  const send = useMutation({
    mutationFn: async () => {
      setError(null);
      if (sendEmail) {
        unwrap(
          await api.documents.sendEmail({
            params: { id: documentId },
            body: { to: emailTo, subject, body, locale, attachPdf },
          }),
        );
      }
      if (sendWhatsapp) {
        unwrap(
          await apiModules.whatsapp.sendDocument({
            params: { id: documentId },
            body: {
              phone,
              message: body.slice(0, 1024),
              locale,
              attachPdf,
              savePhoneToContact: savePhone && !savedPhone,
            },
          }),
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success(sendWhatsapp ? t('Document envoyé par WhatsApp') : t('E-mail envoyé'));
      onClose();
      router.refresh();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Envoi impossible')),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isWhatsapp ? t('Envoyer par WhatsApp') : t('Envoyer par e-mail')}
      description={t('Le document est envoyé au destinataire et passe au statut « Envoyé ».')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant="primary"
            loading={send.isPending}
            disabled={
              (!sendEmail && !sendWhatsapp) ||
              (sendEmail && !subject.trim()) ||
              (sendWhatsapp && !phone.trim())
            }
            onClick={() => send.mutate()}
          >
            <Icon name={isWhatsapp ? 'whatsapp' : 'mail'} />
            {t('Envoyer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>

        {!isWhatsapp && (
          <>
            <Field label={t('Destinataires')} hint={t('Séparés par des virgules')} required>
              <Input value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>

            <Field label={t('Objet')} required>
              <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
            </Field>
          </>
        )}

        <Field label={t('Message')}>
          <Textarea
            value={body}
            rows={6}
            onChange={(event) => setBody(event.target.value)}
            className="min-h-32"
          />
        </Field>

        {isWhatsapp && !whatsappEnabled && (
          <p className="rounded-xl border border-border bg-surface-muted/50 p-3 text-sm text-ink-muted">
            {t('WhatsApp n’est pas configuré.')}{' '}
            <Link href="/settings/whatsapp" className="text-brand hover:underline">
              {t('Voir les réglages')}
            </Link>
          </p>
        )}

        {isWhatsapp && whatsappEnabled && (
          <div className="space-y-3">
            <Field
              label={t('Numéro WhatsApp')}
              hint={savedPhone ? undefined : t('Aucun numéro enregistré pour ce client')}
              required
            >
              <Input
                dir="ltr"
                placeholder="06 12 34 56 78"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>
            {!savedPhone && (
              <Checkbox
                label={t('Enregistrer ce numéro sur la fiche client')}
                checked={savePhone}
                onChange={(event) => setSavePhone(event.target.checked)}
              />
            )}
          </div>
        )}

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
