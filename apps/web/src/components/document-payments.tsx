'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { documentSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { api, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { date, money, paymentMethodLabel } from '@/lib/format';
import { Icon } from './icons';
import { Card, IconButton } from './ui';
import { CancelPaymentDialog, EditPaymentDialog } from './dialogs/payment-edit-dialog';

type Payment = z.infer<typeof documentSchemas.payment>;

/** Payments applied to one document, each editable or cancellable. */
export function DocumentPayments({ documentId, currency }: { documentId: string; currency: string }) {
  const t = useT();
  const [editing, setEditing] = useState<Payment | null>(null);
  const [cancelling, setCancelling] = useState<Payment | null>(null);

  const payments = useQuery({
    queryKey: ['payments', 'document', documentId],
    queryFn: async () => unwrap(await api.payments.list({ query: { documentId, limit: 100 } })),
    retry: false,
  });

  const items = payments.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <Card className="mt-4 p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">{t('Règlements')}</h2>
      <ul className="divide-y divide-line">
        {items.map((payment) => {
          const applied =
            payment.allocations.find((allocation) => allocation.documentId === documentId)?.amount ??
            payment.amount;
          return (
            <li key={payment.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  {money(applied, currency)}
                  <span className="ms-2 font-normal text-ink-muted">
                    {paymentMethodLabel(payment.method)}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                  </span>
                </p>
                <p className="text-xs text-ink-muted">{date(payment.paidAt)}</p>
              </div>
              <span className="flex items-center gap-1">
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
            </li>
          );
        })}
      </ul>
      {editing && <EditPaymentDialog payment={editing} onClose={() => setEditing(null)} />}
      {cancelling && <CancelPaymentDialog payment={cancelling} onClose={() => setCancelling(null)} />}
    </Card>
  );
}
