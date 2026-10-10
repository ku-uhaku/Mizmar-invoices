'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { ContactForm } from '@/components/contact-form';
import { AdvanceDialog, OpeningBalanceDialog } from '@/components/dialogs/opening-balance-dialog';
import { useT } from '@/lib/i18n/provider';
import { Icon } from '@/components/icons';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorNote,
  LinkButton,
  Segmented,
  Skeleton,
  StatCard,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { date, documentTypeLabel, money } from '@/lib/format';

const AGEING_LABELS: Record<string, string> = {
  CURRENT: 'Non échu',
  D1_30: '1 – 30 j',
  D31_60: '31 – 60 j',
  D61_90: '61 – 90 j',
  D90_PLUS: '> 90 j',
};

const KIND_LABELS: Record<string, string> = {
  CLIENT: 'Client',
  SUPPLIER: 'Fournisseur',
  BOTH: 'Client & fournisseur',
};

export default function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tab, setTab] = useState<'statement' | 'documents' | 'profile'>('statement');

  const statement = useQuery({
    queryKey: ['statement', id],
    queryFn: async () => unwrap(await api.contacts.statement({ params: { id }, query: {} })),
  });

  const documents = useQuery({
    queryKey: ['documents', 'contact', id],
    queryFn: async () => unwrap(await api.documents.list({ query: { contactId: id, limit: 100 } })),
    enabled: tab === 'documents',
  });

  const remove = useMutation({
    mutationFn: async () => unwrap(await api.contacts.remove({ params: { id } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['contacts'] });
      toast.success(t('Tiers supprimé'));
      router.push('/contacts');
    },
    onError: (cause) =>
      setDeleteError(cause instanceof ApiError ? cause.message : t('Suppression impossible')),
  });

  if (statement.isPending) {
    return (
      <div role="status" aria-label={t('Chargement')}>
        <Card className="mb-4 p-5">
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
          </div>
        </Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-card" />
          ))}
        </div>
        <Card className="overflow-hidden">
          <TableSkeleton rows={5} cols={6} />
        </Card>
      </div>
    );
  }

  if (!statement.data) {
    return (
      <Card>
        <EmptyState
          icon="users"
          title={t('Tiers introuvable')}
          description={t('Ce client ou fournisseur n’existe pas ou a été supprimé.')}
          action={
            <LinkButton href="/contacts" variant="secondary">
              {t('Retour à l’annuaire')}
            </LinkButton>
          }
        />
      </Card>
    );
  }

  const { contact, ageing, currency } = statement.data;
  const billing =
    contact.addresses.find((address) => address.kind === 'BILLING') ?? contact.addresses[0];
  const addressLine = billing
    ? [billing.addressLine1, billing.city].filter(Boolean).join(', ')
    : '';
  const outstanding = Number(statement.data.totalOutstanding);

  return (
    <>
      <Link
        href="/contacts"
        className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <Icon name="chevronLeft" className="size-4 rtl:rotate-180" />
        {t('Clients & fournisseurs')}
      </Link>

      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={contact.displayName} className="size-14 text-lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">
                {contact.displayName}
              </h1>
              {contact.kind && (
                <Badge tone={contact.kind === 'SUPPLIER' ? 'info' : 'neutral'}>
                  {t(KIND_LABELS[contact.kind] ?? contact.kind)}
                </Badge>
              )}
            </div>
            {(contact.legalName || contact.ice) && (
              <p className="mt-1 text-sm text-ink-muted">
                {[contact.legalName, contact.ice ? `ICE ${contact.ice}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-muted">
              {contact.email && (
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="mail" /> {contact.email}
                </span>
              )}
              {contact.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-ink-subtle">{t('Tél.')}</span> {contact.phone}
                </span>
              )}
              {addressLine && (
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="warehouse" /> {addressLine}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setOpeningOpen(true)}>
              {t('Solde d’ouverture')}
            </Button>
            <Button variant="secondary" onClick={() => setAdvanceOpen(true)}>
              {t('Avance / prêt')}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t('Modifier')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleteError(null);
                setConfirmDelete(true);
              }}
            >
              {t('Supprimer')}
            </Button>
          </div>
        </div>
      </Card>

      {openingOpen && (
        <OpeningBalanceDialog
          contactId={id}
          contactName={contact.displayName}
          kind={contact.kind}
          current={contact.openingBalance ?? null}
          currency={currency}
          onClose={() => setOpeningOpen(false)}
        />
      )}
      {advanceOpen && (
        <AdvanceDialog
          contactId={id}
          contactName={contact.displayName}
          kind={contact.kind}
          currency={currency}
          onClose={() => setAdvanceOpen(false)}
        />
      )}
      <ContactForm open={editing} onClose={() => setEditing(false)} contact={contact} />
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        width="sm"
        title={t('Supprimer ce tiers ?')}
        description={contact.displayName}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              {t('Annuler')}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              {t('Supprimer')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          {t('Cette action est définitive. Les documents existants conservent leur historique.')}
        </p>
        {deleteError && (
          <div className="mt-3">
            <ErrorNote>{deleteError}</ErrorNote>
          </div>
        )}
      </Dialog>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('Total facturé')}
          icon="invoice"
          value={money(statement.data.totalInvoiced, currency)}
        />
        <StatCard
          label={t('Total réglé')}
          icon="check"
          tone="success"
          value={money(statement.data.totalPaid, currency)}
        />
        <StatCard
          label={t('Encours')}
          icon="wallet"
          tone={outstanding > 0 ? 'progress' : 'neutral'}
          value={money(statement.data.totalOutstanding, currency)}
        />
        <StatCard
          label={t('Solde de clôture')}
          icon="trending"
          value={money(statement.data.closingBalance, currency)}
        />
      </div>

      <Card className="mb-4 overflow-hidden">
        <CardHeader
          title={t('Balance âgée')}
          description={t('Répartition de l’encours par ancienneté')}
        />
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-5">
          {Object.entries(ageing).map(([bucket, value]) => (
            <div key={bucket} className="bg-surface px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                {t(AGEING_LABELS[bucket] ?? bucket)}
              </p>
              <p
                className={clsx(
                  'tabular mt-1 text-sm font-semibold',
                  bucket !== 'CURRENT' && Number(value) > 0 ? 'text-danger' : 'text-ink',
                )}
              >
                {money(value, currency)}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Segmented
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'statement', label: t('Relevé de compte') },
          { value: 'documents', label: t('Documents') },
          { value: 'profile', label: t('Fiche') },
        ]}
      />

      {tab === 'statement' && (
        <Card className="overflow-hidden">
          <CardHeader
            title={t('Relevé de compte')}
            description={t('Au {date} · solde d’ouverture {amount}', {
              date: date(statement.data.to),
              amount: money(statement.data.openingBalance, currency),
            })}
          />
          {statement.data.rows.length === 0 ? (
            <EmptyState
              icon="file"
              title={t('Aucun mouvement sur la période')}
              description={t('Les factures et règlements apparaîtront ici.')}
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('Date')}</Th>
                  <Th>{t('Libellé')}</Th>
                  <Th>{t('Échéance')}</Th>
                  <Th numeric>{t('Débit')}</Th>
                  <Th numeric>{t('Crédit')}</Th>
                  <Th numeric>{t('Solde')}</Th>
                  <Th numeric>{t('Retard')}</Th>
                </tr>
              </thead>
              <tbody>
                {statement.data.rows.map((row, index) => (
                  <tr key={`${row.documentId}-${index}`}>
                    <Td className="whitespace-nowrap text-ink-muted">{date(row.issueDate)}</Td>
                    <Td>
                      {row.documentType === 'PAYMENT' || row.documentType === 'OPENING' ? (
                        row.label
                      ) : (
                        <Link
                          href={`/documents/${row.documentId}`}
                          className="text-brand hover:underline"
                        >
                          {row.number ?? documentTypeLabel(row.documentType)}
                        </Link>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-muted">{date(row.dueDate)}</Td>
                    <Td numeric>{row.debit === '0.00' ? '—' : money(row.debit, currency)}</Td>
                    <Td numeric>{row.credit === '0.00' ? '—' : money(row.credit, currency)}</Td>
                    <Td numeric className="font-medium">
                      {money(row.runningBalance, currency)}
                    </Td>
                    <Td
                      numeric
                      className={
                        row.daysOverdue > 0 ? 'font-medium text-danger' : 'text-ink-subtle'
                      }
                    >
                      {row.daysOverdue > 0 ? `${row.daysOverdue} ${t('j')}` : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'documents' && (
        <Card className="overflow-hidden">
          <CardHeader title={t('Documents')} />
          {documents.isPending ? (
            <TableSkeleton rows={5} cols={5} />
          ) : documents.data && documents.data.items.length > 0 ? (
            <Table>
              <thead>
                <tr>
                  <Th>{t('Numéro')}</Th>
                  <Th>{t('Type')}</Th>
                  <Th>{t('Date')}</Th>
                  <Th numeric>{t('Total TTC')}</Th>
                  <Th numeric>{t('Reste dû')}</Th>
                </tr>
              </thead>
              <tbody>
                {documents.data.items.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/documents/${row.id}`)}
                    className="cursor-pointer transition hover:bg-surface-muted"
                  >
                    <Td>
                      <Link
                        href={`/documents/${row.id}`}
                        onClick={(event) => event.stopPropagation()}
                        className="font-medium text-brand hover:underline"
                      >
                        {row.number ?? t('Brouillon {label}', { label: row.draftLabel ?? '' })}
                      </Link>
                    </Td>
                    <Td className="text-ink-muted">{documentTypeLabel(row.type)}</Td>
                    <Td className="text-ink-muted">{date(row.issueDate)}</Td>
                    <Td numeric>{money(row.totalInclVat, row.currency)}</Td>
                    <Td numeric>
                      {row.settlement === 'NOT_APPLICABLE'
                        ? '—'
                        : money(row.outstandingAmount, row.currency)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState
              icon="file"
              title={t('Aucun document')}
              description={t('Aucun document n’est rattaché à ce tiers.')}
            />
          )}
        </Card>
      )}

      {tab === 'profile' && (
        <Card>
          <CardHeader title={t('Fiche')} />
          <dl className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-3">
            <Info label={t('Raison sociale')}>{contact.legalName ?? '—'}</Info>
            <Info label="ICE">{contact.ice ?? '—'}</Info>
            <Info label="RC">{contact.rc ?? '—'}</Info>
            <Info label="IF">{contact.taxId ?? '—'}</Info>
            <Info label={t('Patente')}>{contact.patente ?? '—'}</Info>
            <Info label={t('E-mail')}>{contact.email ?? '—'}</Info>
            <Info label={t('Téléphone')}>{contact.phone ?? '—'}</Info>
            <Info label={t('Conditions de paiement')}>{contact.paymentTerm.replace(/_/g, ' ')}</Info>
            <Info label={t('Plafond d’encours')}>
              {contact.creditLimit ? money(contact.creditLimit, currency) : '—'}
            </Info>
          </dl>

          {contact.addresses.length > 0 && (
            <div className="border-t border-border p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                {t('Adresses')}
              </p>
              <ul className="space-y-2 text-sm">
                {contact.addresses.map((address) => (
                  <li key={address.id}>
                    <span className="text-ink-subtle">
                      {address.kind === 'BILLING' ? t('Facturation') : t('Livraison')} —{' '}
                    </span>
                    {[address.addressLine1, address.addressLine2, address.postalCode, address.city]
                      .filter(Boolean)
                      .join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}
