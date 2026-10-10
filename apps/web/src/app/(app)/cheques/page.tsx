'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { documentSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { apiModules, ApiError, unwrap } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  StatCard,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { date, dateTime, money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { NEXT_STATUSES, PAYMENT_STATUS, STATUS_ACTION, type PaymentStatus } from '@/lib/payment-status';

type Payment = z.infer<typeof documentSchemas.payment>;
type Direction = 'ALL' | 'INBOUND' | 'OUTBOUND';

const DAY = 24 * 60 * 60 * 1000;

/** Open instruments are flagged once overdue, and a week ahead of the due date. */
function dueTone(payment: Payment): 'danger' | 'progress' | null {
  if (!payment.dueDate || (payment.status !== 'PENDING' && payment.status !== 'DEPOSITED')) return null;
  const days = (new Date(payment.dueDate).getTime() - Date.now()) / DAY;
  if (days < -1) return 'danger';
  return days <= 7 ? 'progress' : null;
}

export default function ChequesPage() {
  const t = useT();
  const [status, setStatus] = useState<PaymentStatus | 'ALL'>('PENDING');
  const [direction, setDirection] = useState<Direction>('ALL');
  const [search, setSearch] = useState('');
  const [acting, setActing] = useState<{ payment: Payment; target?: PaymentStatus } | null>(null);

  const list = useQuery({
    queryKey: ['cheques', status, direction, search],
    queryFn: async () =>
      unwrap(
        await apiModules.cheques.list({
          query: {
            ...(status !== 'ALL' ? { status } : {}),
            ...(direction !== 'ALL' ? { direction } : {}),
            ...(search.trim() ? { search: search.trim() } : {}),
          },
        }),
      ),
  });

  const summary = list.data?.summary;
  const items = list.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t('Suivi des chèques')}
        subtitle={t('Chèques et effets : de la réception à l’encaissement')}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t(PAYMENT_STATUS.PENDING.label)}
          value={money(summary?.PENDING.amount ?? '0')}
          hint={t('{n} pièce(s)', { n: summary?.PENDING.count ?? 0 })}
          icon="clock"
          tone="progress"
        />
        <StatCard
          label={t(PAYMENT_STATUS.DEPOSITED.label)}
          value={money(summary?.DEPOSITED.amount ?? '0')}
          hint={t('{n} pièce(s)', { n: summary?.DEPOSITED.count ?? 0 })}
          icon="download"
          tone="neutral"
        />
        <StatCard
          label={t(PAYMENT_STATUS.CLEARED.label)}
          value={money(summary?.CLEARED.amount ?? '0')}
          hint={t('{n} pièce(s)', { n: summary?.CLEARED.count ?? 0 })}
          icon="check"
          tone="success"
        />
        <StatCard
          label={t(PAYMENT_STATUS.BOUNCED.label)}
          value={money(summary?.BOUNCED.amount ?? '0')}
          hint={t('{n} pièce(s)', { n: summary?.BOUNCED.count ?? 0 })}
          icon="alert"
          tone="danger"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'ALL', label: t('Tous') },
            ...(Object.keys(PAYMENT_STATUS) as PaymentStatus[]).map((value) => ({
              value,
              label: t(PAYMENT_STATUS[value].label),
              count: summary?.[value].count,
            })),
          ]}
        />
        <Segmented
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'ALL', label: t('Tous') },
            { value: 'INBOUND', label: t('Reçus') },
            { value: 'OUTBOUND', label: t('Émis') },
          ]}
        />
        <SearchInput
          className="w-full sm:ms-auto sm:w-64"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('N°, banque, tiers…')}
        />
      </div>

      <Card className="overflow-hidden">
        {list.isPending ? (
          <TableSkeleton rows={6} cols={7} />
        ) : items.length > 0 ? (
          <Table className="min-w-[980px]">
            <thead>
              <tr>
                <Th>{t('Échéance')}</Th>
                <Th>{t('N°')}</Th>
                <Th>{t('Tiers')}</Th>
                <Th>{t('Banque')}</Th>
                <Th>{t('Sens')}</Th>
                <Th numeric>{t('Montant')}</Th>
                <Th>{t('Statut')}</Th>
                <Th className="w-44" />
              </tr>
            </thead>
            <tbody>
              {items.map((payment) => {
                const tone = dueTone(payment);
                const next = NEXT_STATUSES[payment.status];
                const primary = payment.status === 'PENDING' ? 'DEPOSITED' : next.includes('CLEARED') ? 'CLEARED' : undefined;
                return (
                  <tr key={payment.id} className="hover:bg-surface-muted/60">
                    <Td className="whitespace-nowrap">
                      {payment.dueDate ? (
                        <Badge tone={tone ?? 'neutral'}>{date(payment.dueDate)}</Badge>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </Td>
                    <Td className="font-medium">
                      {payment.reference ?? '—'}
                      <span className="block text-xs font-normal text-ink-subtle">
                        {payment.methodName ? t(payment.methodName) : payment.method}
                      </span>
                    </Td>
                    <Td>
                      <Link href={`/contacts/${payment.contactId}`} className="font-medium text-ink hover:text-brand">
                        {payment.contactName}
                      </Link>
                      <span className="flex flex-wrap gap-x-2">
                        {payment.allocations.map((allocation) => (
                          <Link
                            key={allocation.documentId}
                            href={`/documents/${allocation.documentId}`}
                            className="text-xs text-brand hover:underline"
                          >
                            {allocation.documentNumber ?? '—'}
                          </Link>
                        ))}
                      </span>
                    </Td>
                    <Td className="text-ink-muted">{payment.bankName ?? '—'}</Td>
                    <Td>
                      <Badge tone={payment.direction === 'INBOUND' ? 'success' : 'neutral'}>
                        {payment.direction === 'INBOUND' ? t('Chèque reçu') : t('Chèque émis')}
                      </Badge>
                    </Td>
                    <Td numeric className="font-semibold">
                      {money(payment.amount, payment.currency)}
                    </Td>
                    <Td>
                      <Badge tone={PAYMENT_STATUS[payment.status].tone}>{t(PAYMENT_STATUS[payment.status].label)}</Badge>
                    </Td>
                    <Td>
                      <span className="flex justify-end gap-1.5">
                        {primary && (
                          <Button size="sm" variant="primary" onClick={() => setActing({ payment, target: primary })}>
                            {t(primary === 'DEPOSITED' ? 'Remettre en banque' : 'Marquer encaissé')}
                          </Button>
                        )}
                        <Button size="sm" onClick={() => setActing({ payment })}>
                          {t('Suivi')}
                        </Button>
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon="wallet"
            title={t('Aucun chèque ou effet')}
            description={t('Les paiements par chèque ou par effet enregistrés apparaîtront ici.')}
          />
        )}
      </Card>

      {acting && (
        <StatusDialog payment={acting.payment} initial={acting.target} onClose={() => setActing(null)} />
      )}
    </>
  );
}

/** Move a payment to its next status and read what happened to it so far. */
function StatusDialog({
  payment,
  initial,
  onClose,
}: {
  payment: Payment;
  initial?: PaymentStatus;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const options = NEXT_STATUSES[payment.status];
  const [target, setTarget] = useState<PaymentStatus | ''>(initial ?? options[0] ?? '');
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ['cheques', 'history', payment.id],
    queryFn: async () => unwrap(await apiModules.cheques.history({ params: { id: payment.id } })),
  });

  const apply = useMutation({
    mutationFn: async () => {
      setError(null);
      if (!target) return null;
      return unwrap(
        await apiModules.cheques.setStatus({
          params: { id: payment.id },
          body: { status: target, date: when, note: note.trim() || undefined },
        }),
      );
    },
    onSuccess: () => {
      // Balances on invoices, reports and the dashboard all depend on this.
      void queryClient.invalidateQueries();
      toast.success(t('Statut mis à jour'));
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="md"
      title={`${payment.reference ?? t('Paiement')} · ${money(payment.amount, payment.currency)}`}
      description={payment.contactName}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Fermer')}
          </Button>
          {options.length > 0 && (
            <Button variant="primary" loading={apply.isPending} disabled={!target} onClick={() => apply.mutate()}>
              {t('Enregistrer')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNote>{error}</ErrorNote>

        {options.length > 0 ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Nouveau statut')}>
                <Select value={target} onChange={(event) => setTarget(event.target.value as PaymentStatus)}>
                  {options.map((value) => (
                    <option key={value} value={value}>
                      {t(STATUS_ACTION[value])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('Date')}>
                <Input type="date" value={when} onChange={(event) => setWhen(event.target.value)} />
              </Field>
            </div>
            {target === 'BOUNCED' && (
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {t('Les factures réglées par ce paiement redeviennent à payer.')}
              </p>
            )}
            <Field label={t('Note')}>
              <Input value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{t('Ce paiement est clos : aucun changement possible.')}</p>
        )}

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
            {t('Historique')}
          </p>
          <ul className="space-y-2">
            {(history.data ?? []).map((event) => (
              <li key={event.id} className="flex items-start gap-3 text-sm">
                <Badge tone={PAYMENT_STATUS[event.status].tone}>{t(PAYMENT_STATUS[event.status].label)}</Badge>
                <span className="flex-1 text-ink-muted">
                  {dateTime(event.at)}
                  {event.userName ? ` · ${event.userName}` : ''}
                  {event.note ? ` — ${event.note}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
