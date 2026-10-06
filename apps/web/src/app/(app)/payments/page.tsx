'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  IconButton,
  PageHeader,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { date, money, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

export default function PaymentsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [toRemove, setToRemove] = useState<{ id: string; contactName: string; amount: string } | null>(
    null,
  );

  const payments = useQuery({
    queryKey: ['payments', 'all'],
    queryFn: async () => unwrap(await api.payments.list({ query: { limit: 100 } })),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await api.payments.remove({ params: { id } })),
    onSuccess: () => {
      // Removing a payment reopens the invoices it settled.
      void queryClient.invalidateQueries();
      toast.success(t('Paiement supprimé'));
      setToRemove(null);
    },
    onError: (cause) => {
      setToRemove(null);
      toast.error(cause instanceof ApiError ? cause.message : t('Suppression impossible'));
    },
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
                    <IconButton
                      label={t('Supprimer')}
                      onClick={() =>
                        setToRemove({
                          id: payment.id,
                          contactName: payment.contactName,
                          amount: money(payment.amount, payment.currency),
                        })
                      }
                      className="hover:bg-danger-soft hover:text-danger"
                    >
                      <Icon name="x" />
                    </IconButton>
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

      {toRemove && (
        <Dialog
          open
          onClose={() => setToRemove(null)}
          title={t('Supprimer ce paiement ?')}
          description={t(
            'Le paiement de {amount} de {name} sera supprimé et les factures concernées redeviendront impayées.',
            { amount: toRemove.amount, name: toRemove.contactName },
          )}
          footer={
            <>
              <Button variant="ghost" onClick={() => setToRemove(null)}>
                {t('Annuler')}
              </Button>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() => remove.mutate(toRemove.id)}
              >
                {t('Supprimer')}
              </Button>
            </>
          }
        >
          <></>
        </Dialog>
      )}
    </>
  );
}
