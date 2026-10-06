'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { DocumentType } from '@mizmar/core';
import { api, ApiError, unwrap } from '@/lib/api';
import Link from 'next/link';
import clsx from 'clsx';
import { Icon, type IconName } from '@/components/icons';
import {
  Button,
  Card,
  CardHeader,
  ErrorNote,
  Field,
  Input,
  LinkButton,
  Skeleton,
  toast,
} from '@/components/ui';
import { documentTypeLabel } from '@/lib/format';
import { Combobox } from '@/components/combobox';
import { ContactForm } from '@/components/contact-form';
import { useT } from '@/lib/i18n/provider';

const TYPES: DocumentType[] = [
  'DEVIS',
  'SALES_ORDER',
  'DELIVERY_NOTE',
  'SALES_INVOICE',
  'PURCHASE_ORDER',
  'GOODS_RECEIPT',
  'PURCHASE_INVOICE',
];

const TYPE_ICONS: Record<string, IconName> = {
  DEVIS: 'quote',
  SALES_ORDER: 'order',
  DELIVERY_NOTE: 'truck',
  SALES_INVOICE: 'invoice',
  PURCHASE_ORDER: 'cart',
  GOODS_RECEIPT: 'box',
  PURCHASE_INVOICE: 'invoice',
};

const PURCHASE_TYPES = new Set<DocumentType>([
  'PURCHASE_ORDER',
  'GOODS_RECEIPT',
  'PURCHASE_INVOICE',
]);

function NewDocumentForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [type, setType] = useState<DocumentType>(
    (params.get('type') as DocumentType | null) ?? 'DEVIS',
  );
  const [contactId, setContactId] = useState('');
  const [contactLabel, setContactLabel] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [creatingContact, setCreatingContact] = useState<string | null>(null);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  // The contact list is filtered by side: you do not invoice a supplier.
  const kind = PURCHASE_TYPES.has(type) ? 'SUPPLIER' : 'CLIENT';
  const contacts = useQuery({
    queryKey: ['contacts', 'new-document', kind, contactSearch],
    queryFn: async () =>
      unwrap(
        await api.contacts.list({
          query: { kind, limit: 20, ...(contactSearch ? { search: contactSearch } : {}) },
        }),
      ),
    placeholderData: (previous) => previous,
  });

  const create = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await api.documents.create({
          body: { type, contactId, issueDate, lines: [] },
        }),
      );
    },
    onSuccess: (created) => {
      toast.success(t('Brouillon créé'));
      router.push(`/documents/${created.id}`);
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Création impossible')),
  });

  const cancelHref = `/documents?type=${type}`;

  return (
    <>
      <div className="mb-6">
        <Link
          href={cancelHref}
          className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <Icon name="chevronLeft" className="rtl:rotate-180" />
          {t('Documents')}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('Nouveau document')}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t('Choisissez le type et le tiers, vous ajouterez les lignes à l’étape suivante.')}
        </p>
      </div>

      <div className="max-w-3xl space-y-4">
        <Card>
          <CardHeader title={t('Type de document')} />
          <div
            role="radiogroup"
            aria-label={t('Type de document')}
            className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {TYPES.map((value) => {
              const active = value === type;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setType(value);
                    setContactId('');
                  }}
                  className={clsx(
                    'flex items-center gap-3 rounded-xl border px-3 py-3 text-start text-sm font-medium transition',
                    active
                      ? 'border-brand bg-brand-soft text-brand ring-1 ring-brand/30'
                      : 'border-border text-ink hover:border-border-strong hover:bg-surface-muted',
                  )}
                >
                  <span
                    className={clsx(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg',
                      active
                        ? 'bg-brand text-white dark:text-canvas'
                        : 'bg-surface-muted text-ink-muted',
                    )}
                  >
                    <Icon name={TYPE_ICONS[value] ?? 'file'} />
                  </span>
                  {documentTypeLabel(value)}
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title={t('Tiers & date')} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field
              label={kind === 'SUPPLIER' ? t('Fournisseur') : t('Client')}
              required
              hint={contacts.data?.items.length === 0 && !contactSearch ? t('Aucun tiers de ce type') : undefined}
              className="sm:col-span-2"
            >
              <Combobox
                value={contactId}
                selectedLabel={contactLabel}
                placeholder={t('— Sélectionner —')}
                searchPlaceholder={t('Nom, ICE, téléphone…')}
                options={(contacts.data?.items ?? []).map((contact) => ({
                  value: contact.id,
                  label: contact.displayName,
                  description: [contact.ice, contact.phone].filter(Boolean).join(' · ') || undefined,
                }))}
                loading={contacts.isFetching}
                onSearch={setContactSearch}
                onChange={(value, option) => {
                  setContactId(value);
                  setContactLabel(option?.label ?? '');
                }}
                onCreate={(query) => setCreatingContact(query)}
                createLabel={(query) => t('Nouveau tiers « {q} »', { q: query })}
              />
              <ContactForm
                open={creatingContact !== null}
                onClose={() => setCreatingContact(null)}
                defaultKind={kind}
                initialName={creatingContact ?? ''}
                onSaved={(saved) => {
                  setContactId(saved.id);
                  setContactLabel(saved.displayName);
                }}
              />
            </Field>

            <Field label={t('Date')}>
              <Input
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
              />
            </Field>
          </div>
        </Card>

        <ErrorNote>{error}</ErrorNote>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <LinkButton href={cancelHref} variant="secondary">
            {t('Annuler')}
          </LinkButton>
          <Button
            variant="primary"
            disabled={!contactId}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            {t('Créer le brouillon')}
          </Button>
        </div>
      </div>
    </>
  );
}

export default function NewDocumentPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full max-w-3xl rounded-card" />}>
      <NewDocumentForm />
    </Suspense>
  );
}
