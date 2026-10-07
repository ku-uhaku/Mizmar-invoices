'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DocumentType } from '@mizmar/core';
import { api, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { DocBadges } from '@/components/doc-badges';
import { DocumentEditor } from '@/components/document-editor';
import { DocumentView } from '@/components/document-view';
import { DocumentHistory } from '@/components/audit-log';
import { ConvertDialog } from '@/components/dialogs/convert-dialog';
import { EmailDialog } from '@/components/dialogs/email-dialog';
import { PaymentDialog } from '@/components/dialogs/payment-dialog';
import { ValidateDialog } from '@/components/dialogs/validate-dialog';
import { Icon, type IconName } from '@/components/icons';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  Skeleton,
  Textarea,
  toast,
} from '@/components/ui';
import { date, documentTypeLabel, documentTypePluralLabel } from '@/lib/format';

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [validateOpen, setValidateOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<DocumentType | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['document', id],
    queryFn: async () => unwrap(await api.documents.get({ params: { id } })),
  });

  const pdf = useMutation({
    mutationFn: async (locale: 'FR' | 'EN' | 'AR') => {
      setActionError(null);
      return unwrap(
        await api.documents.renderPdf({
          params: { id },
          body: { locale, forceRerender: false },
        }),
      );
    },
    // Opened rather than downloaded, so the browser's own print dialog is one
    // keystroke away — which is how most of these actually reach paper.
    onSuccess: (result) => window.open(result.url, '_blank', 'noopener'),
    onError: (cause) =>
      setActionError(cause instanceof ApiError ? cause.message : t('PDF indisponible')),
  });

  const cancel = useMutation({
    mutationFn: async (reason: string) => {
      setActionError(null);
      return unwrap(await api.documents.cancel({ params: { id }, body: { reason } }));
    },
    onSuccess: () => {
      setCancelOpen(false);
      setCancelReason('');
      toast.success(t('Document annulé'));
      void queryClient.invalidateQueries();
      router.refresh();
    },
    onError: (cause) => {
      setCancelOpen(false);
      setActionError(cause instanceof ApiError ? cause.message : t('Annulation impossible'));
    },
  });

  const duplicate = useMutation({
    mutationFn: async () => unwrap(await api.documents.duplicate({ params: { id }, body: {} })),
    onSuccess: (created) => {
      toast.success(t('Document dupliqué en brouillon'));
      router.push(`/documents/${created.id}`);
    },
    onError: (cause) =>
      setActionError(cause instanceof ApiError ? cause.message : t('Duplication impossible')),
  });

  // Additive: turn this invoice into a schedule (its lines become the template).
  const makeRecurring = useMutation({
    mutationFn: async () => unwrap(await api.recurring.fromDocument({ params: { id }, body: {} })),
    onSuccess: (created) => {
      toast.success(
        t('Facture récurrente créée, première échéance le {date}', {
          date: created.nextRunAt ?? '—',
        }),
      );
      router.push('/recurring');
    },
    onError: (cause) =>
      setActionError(cause instanceof ApiError ? cause.message : t('Action impossible')),
  });

  if (query.isPending) {
    return (
      <div className="space-y-6" role="status" aria-label={t('Chargement')}>
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-card" />
            <Skeleton className="h-64 w-full rounded-card" />
          </div>
          <Skeleton className="h-72 w-full rounded-card" />
        </div>
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <Card>
        <EmptyState
          icon="alert"
          title={t('Document introuvable')}
          description={query.error instanceof Error ? query.error.message : undefined}
          action={
            <Link href="/documents" className="text-sm font-medium text-brand hover:underline">
              {t('Retour aux documents')}
            </Link>
          }
        />
      </Card>
    );
  }

  const document = query.data;
  const isDraft = document.lifecycle === 'DRAFT';
  const isCancelled = document.lifecycle === 'CANCELLED';
  const settles = document.settlement !== 'NOT_APPLICABLE';
  const canPay = settles && Number(document.outstandingAmount) > 0 && !isDraft && !isCancelled;
  const targets = isCancelled ? [] : document.conversionTargets;

  // The single most likely next step becomes the primary button.
  type Primary = { label: string; icon: IconName; onClick: () => void };
  let primary: Primary | null = null;
  let convertInMenu = targets;
  let emailIsPrimary = false;
  if (isDraft) {
    primary = { label: t('Valider'), icon: 'check', onClick: () => setValidateOpen(true) };
  } else if (canPay) {
    primary = {
      label: t('Enregistrer un règlement'),
      icon: 'wallet',
      onClick: () => setPaymentOpen(true),
    };
  } else if (targets.length > 0) {
    const first = targets[0]!;
    primary = {
      label: t('Convertir en {type}', { type: documentTypeLabel(first).toLowerCase() }),
      icon: 'arrowRight',
      onClick: () => setConvertTarget(first),
    };
    convertInMenu = targets.slice(1);
  } else if (!isCancelled) {
    emailIsPrimary = true;
  }

  const listHref = `/documents?type=${document.type}`;
  const title = document.number ?? `${t('Brouillon')} ${document.draftLabel}`;

  return (
    <>
      <div className="mb-6">
        <Link
          href={listHref}
          className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <Icon name="chevronLeft" className="rtl:rotate-180" />
          {documentTypePluralLabel(document.type)}
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              {documentTypeLabel(document.type)}
            </p>
            <h1 className="mt-0.5 break-words text-3xl font-semibold tracking-tight text-ink">
              {title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-muted">
              <Link
                href={`/contacts/${document.contactId}`}
                className="font-medium text-ink hover:text-brand hover:underline"
              >
                {document.contactName}
              </Link>
              <span aria-hidden>·</span>
              <span>{date(document.issueDate)}</span>
              <DocBadges badges={document.badges} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {primary && (
              <Button variant="primary" onClick={primary.onClick}>
                <Icon name={primary.icon} />
                {primary.label}
              </Button>
            )}
            {!isDraft && !isCancelled && (
              <Button
                variant={emailIsPrimary ? 'primary' : 'secondary'}
                onClick={() => setEmailOpen(true)}
              >
                <Icon name="mail" />
                {t('Envoyer')}
              </Button>
            )}
            <Button variant="secondary" loading={pdf.isPending} onClick={() => pdf.mutate('FR')}>
              <Icon name="printer" />
              PDF
            </Button>
            <MoreMenu>
              {(close) => (
                <>
                  {convertInMenu.map((target) => (
                    <MenuItem
                      key={target}
                      icon="arrowRight"
                      onClick={() => {
                        close();
                        setConvertTarget(target);
                      }}
                    >
                      {t('Convertir en {type}', { type: documentTypeLabel(target).toLowerCase() })}
                    </MenuItem>
                  ))}
                  <MenuItem
                    icon="file"
                    disabled={duplicate.isPending}
                    onClick={() => {
                      close();
                      duplicate.mutate();
                    }}
                  >
                    {t('Dupliquer')}
                  </MenuItem>
                  {document.type === 'SALES_INVOICE' && (
                    <MenuItem
                      icon="clock"
                      disabled={makeRecurring.isPending}
                      onClick={() => {
                        close();
                        makeRecurring.mutate();
                      }}
                    >
                      {t('Créer une facture récurrente')}
                    </MenuItem>
                  )}
                  {document.canCancel && !isCancelled && (
                    <>
                      <div className="my-1 border-t border-border" />
                      <MenuItem
                        icon="x"
                        danger
                        onClick={() => {
                          close();
                          setCancelOpen(true);
                        }}
                      >
                        {t('Annuler le document')}
                      </MenuItem>
                    </>
                  )}
                </>
              )}
            </MoreMenu>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="mb-4">
          <ErrorNote>{actionError}</ErrorNote>
        </div>
      )}

      {isCancelled && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm text-danger"
        >
          <Icon name="alert" className="mt-0.5" />
          <p>
            {t('Document annulé')}
            {document.cancelReason ? ` — ${document.cancelReason}` : ''}.{' '}
            {t('Les mouvements de stock ont été compensés par des écritures inverses.')}
          </p>
        </div>
      )}

      {isDraft ? <DocumentEditor document={document} /> : <DocumentView document={document} />}

      <div className="mt-4">
        <DocumentHistory documentId={document.id} />
      </div>

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('Annuler ce document ?')}
        description={`${documentTypeLabel(document.type)} ${title}`}
        width="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              {t('Retour')}
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              disabled={!cancelReason.trim()}
              onClick={() => cancel.mutate(cancelReason.trim())}
            >
              {t('Annuler le document')}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-ink-muted">
          {t(
            'Cette action est définitive : les mouvements de stock seront compensés par des écritures inverses.',
          )}
        </p>
        <Field label={t('Motif de l’annulation')} required>
          <Textarea
            autoFocus
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder={t('Ex. erreur de saisie, commande annulée par le client…')}
          />
        </Field>
      </Dialog>

      <ValidateDialog documentId={id} open={validateOpen} onClose={() => setValidateOpen(false)} />
      <ConvertDialog
        documentId={id}
        targetType={convertTarget}
        open={convertTarget !== null}
        onClose={() => setConvertTarget(null)}
      />
      <PaymentDialog
        documentId={id}
        contactId={document.contactId}
        outstanding={document.outstandingAmount}
        currency={document.currency}
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
      />
      <EmailDialog
        documentId={id}
        defaultTo=""
        defaultSubject={`${documentTypeLabel(document.type)} ${document.number ?? ''}`.trim()}
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// "Plus d'actions" dropdown
// ---------------------------------------------------------------------------

function MoreMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" />
        <span className="hidden sm:inline">{t('Plus d’actions')}</span>
        <span className="sr-only sm:hidden">{t('Plus d’actions')}</span>
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-11 z-30 w-64 animate-pop-in rounded-xl border border-border bg-surface p-1.5 shadow-(--shadow-pop)"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  danger,
  disabled,
  onClick,
  children,
}: {
  icon: IconName;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={
        'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-sm transition disabled:opacity-60 ' +
        (danger ? 'text-danger hover:bg-danger-soft' : 'text-ink hover:bg-surface-muted')
      }
    >
      <Icon name={icon} className={danger ? undefined : 'text-ink-muted'} />
      {children}
    </button>
  );
}
