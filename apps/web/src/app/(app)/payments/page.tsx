'use client';

import { useQuery } from '@tanstack/react-query';
import type { documentSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import Link from 'next/link';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import {
  Badge,
  Card,
  EmptyState,
  IconButton,
  PageHeader,
  Table,
  TableSkeleton,
  Td,
  Th,
} from '@/components/ui';
import { CancelPaymentDialog, EditPaymentDialog } from '@/components/dialogs/payment-edit-dialog';
import { date, money, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

type Payment = z.infer<typeof documentSchemas.payment>;

export default function PaymentsPage() {
  const t = useT();
  const [editing, setEditing] = useState<Payment | null>(null);
  const [cancelling, setCancelling] = useState<Payment | null>(null);

  const payments = useQuery({
    queryKey: ['payments', 'all'],
    queryFn: async () => unwrap(await api.payments.list({ query: { limit: 100 } })),
  });

  const count = payments.data?.items.length;

  return (
    <>
      <PageHeader
        title={t('Paiements')}
        subtitle={
          count === undefined
            ? t('Encaissements et décaissements')
            : t('{n} paiement(s)', { n: count })
        }
      />

      <Card className="overflow-hidden">
        {payments.isPending ? (
          <TableSkeleton rows={6} cols={6} />
        ) : payments.data && payments.data.items.length > 0 ? (
          <Table className="min-w-[820px]">
            <thead>
              <tr>
                <Th>{t('Date')}</Th>
                <Th>{t('Contact')}</Th>
                <Th>{t('Sens')}</Th>
                <Th>{t('Mode')}</Th>
                <Th>{t('Référence')}</Th>
                <Th>{t('Documents')}</Th>
                <Th numeric>{t('Montant')}</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {payments.data.items.map((payment) => (
                <tr key={payment.id} className="hover:bg-surface-muted/60">
                  <Td className="whitespace-nowrap text-ink-muted">{date(payment.paidAt)}</Td>
                  <Td>
                    <Link
                      href={`/contacts/${payment.contactId}`}
                      className="font-medium text-ink hover:text-brand"
                    >
                      {payment.contactName}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={payment.direction === 'INBOUND' ? 'success' : 'neutral'}>
                      {payment.direction === 'INBOUND' ? t('Encaissement') : t('Décaissement')}
                    </Badge>
                  </Td>
                  <Td className="text-ink-muted">
                    {t(PAYMENT_METHOD_LABELS[payment.method] ?? payment.method)}
                  </Td>
                  <Td className="text-ink-muted">{payment.reference ?? '—'}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-x-2">
                      {payment.allocations.map((allocation) => (
                        <Link
                          key={allocation.documentId}
                          href={`/documents/${allocation.documentId}`}
                          className="text-xs font-medium text-brand hover:underline"
                        >
                          {allocation.documentNumber ?? '—'}
                        </Link>
                      ))}
                    </span>
                  </Td>
                  <Td numeric className="font-semibold">
                    {money(payment.amount, payment.currency)}
                  </Td>
                  <Td>
                    <span className="flex items-center gap-1">
                    <a
                      href={`/receipt/${payment.id}`}
                      target="_blank"
                      rel="noreferrer"
                      title={t('Reçu')}
                      aria-label={t('Reçu')}
                      className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink"
                    >
                      <Icon name="printer" />
                    </a>
                    <IconButton label={t('Modifier')} onClick={() => setEditing(payment)}>
                      <Icon name="edit" />
                    </IconButton>
                    <IconButton
                      label={t('Annuler le paiement')}
                      onClick={() => setCancelling(payment)}
                      className="hover:bg-danger-soft hover:text-danger"
                    >
                      <Icon name="x" />
                    </IconButton>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon="wallet"
            title={t('Aucun paiement pour l’instant')}
            description={t('Les paiements enregistrés depuis une facture apparaîtront ici.')}
          />
        )}
      </Card>

      {editing && <EditPaymentDialog payment={editing} onClose={() => setEditing(null)} />}
      {cancelling && <CancelPaymentDialog payment={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}
