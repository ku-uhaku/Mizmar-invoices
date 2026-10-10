'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { apiModules, unwrap } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Segmented,
  StatCard,
  Table,
  TableSkeleton,
  Td,
  Th,
} from '@/components/ui';
import { PaymentDialog } from '@/components/dialogs/payment-dialog';
import { SupplierPaymentDialog } from '@/components/dialogs/supplier-payment-dialog';
import { date, money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

type Tab = 'bills' | 'ageing';

const BUCKETS = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
const BUCKET_LABELS: Record<string, string> = {
  CURRENT: 'Non échu',
  D1_30: '1-30 jours',
  D31_60: '31-60 jours',
  D61_90: '61-90 jours',
  D90_PLUS: '90+ jours',
};
const BUCKET_TONE = {
  CURRENT: 'neutral',
  D1_30: 'progress',
  D31_60: 'progress',
  D61_90: 'danger',
  D90_PLUS: 'danger',
} as const;

export default function PayablesPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('bills');
  const [paying, setPaying] = useState<{
    documentId: string;
    contactId: string;
    outstanding: string;
    currency: string;
  } | null>(null);
  const [payingSupplier, setPayingSupplier] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ['payables'],
    queryFn: async () => unwrap(await apiModules.payables.overview({ query: {} })),
  });
  const data = overview.data;

  const supplierDocs = (contactId: string) =>
    (data?.items ?? []).filter((item) => item.source === 'DOCUMENT' && item.contactId === contactId);
  const supplier = payingSupplier ? data?.rows.find((row) => row.contactId === payingSupplier) : undefined;

  return (
    <>
      <PageHeader
        title={t('Dettes fournisseurs')}
        subtitle={t('Factures d’achat et dépenses à payer, par échéance')}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label={t('Total à payer')}
          value={money(data?.totals.total ?? '0', data?.currency)}
          hint={t('{n} facture(s)', { n: data?.items.length ?? 0 })}
          icon="wallet"
        />
        <StatCard
          label={t('En retard')}
          value={money(data?.overdueTotal ?? '0', data?.currency)}
          icon="alert"
          tone="danger"
        />
        <StatCard
          label={t('À payer sous 7 jours')}
          value={money(data?.dueSoonTotal ?? '0', data?.currency)}
          icon="clock"
          tone="progress"
        />
      </div>

      <Segmented
        className="mb-3"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'bills', label: t('Factures à payer') },
          { value: 'ageing', label: t('Balance âgée') },
        ]}
      />

      <Card className="overflow-hidden">
        {overview.isPending ? (
          <TableSkeleton rows={6} cols={7} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon="wallet"
            title={t('Rien à payer')}
            description={t('Les factures d’achat validées et les dépenses impayées apparaîtront ici.')}
          />
        ) : tab === 'bills' ? (
          <Table className="min-w-[860px]">
            <thead>
              <tr>
                <Th>{t('Échéance')}</Th>
                <Th>{t('Fournisseur')}</Th>
                <Th>{t('Référence')}</Th>
                <Th>{t('Type')}</Th>
                <Th numeric>{t('Reste dû')}</Th>
                <Th className="w-28" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={`${item.source}-${item.id}`} className="hover:bg-surface-muted/60">
                  <Td className="whitespace-nowrap">
                    {item.dueDate ? (
                      <Badge tone={BUCKET_TONE[item.bucket]}>{date(item.dueDate)}</Badge>
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                    {item.daysOverdue !== null && item.daysOverdue > 0 && (
                      <span className="ms-2 text-xs text-danger">
                        {t('{n} j de retard', { n: item.daysOverdue })}
                      </span>
                    )}
                  </Td>
                  <Td className="font-medium">
                    {item.contactId ? (
                      <Link href={`/contacts/${item.contactId}`} className="hover:text-brand">
                        {item.contactName}
                      </Link>
                    ) : (
                      item.contactName
                    )}
                  </Td>
                  <Td>
                    <Link
                      href={
                        item.source === 'DOCUMENT'
                          ? `/documents/${item.id}`
                          : item.source === 'OPENING'
                            ? `/contacts/${item.contactId}`
                            : '/expenses'
                      }
                      className="text-brand hover:underline"
                    >
                      {item.reference ?? '—'}
                    </Link>
                  </Td>
                  <Td className="text-ink-muted">
                    {item.source === 'DOCUMENT'
                      ? t('Facture d’achat')
                      : item.source === 'OPENING'
                        ? t('Solde d’ouverture')
                        : t('Dépense')}
                  </Td>
                  <Td numeric className="font-semibold">
                    {money(item.outstanding, item.currency)}
                  </Td>
                  <Td>
                    {item.source === 'DOCUMENT' && item.contactId ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          setPaying({
                            documentId: item.id,
                            contactId: item.contactId!,
                            outstanding: item.outstanding,
                            currency: item.currency,
                          })
                        }
                      >
                        {t('Payer')}
                      </Button>
                    ) : (
                      <Link href="/expenses" className="text-xs text-brand hover:underline">
                        {t('Ouvrir')}
                      </Link>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Table className="min-w-[860px]">
            <thead>
              <tr>
                <Th>{t('Fournisseur')}</Th>
                {BUCKETS.map((key) => (
                  <Th key={key} numeric>
                    {t(BUCKET_LABELS[key]!)}
                  </Th>
                ))}
                <Th numeric>{t('Total')}</Th>
                <Th className="w-28" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.contactId ?? 'none'}>
                  <Td className="font-medium">{row.contactName}</Td>
                  {BUCKETS.map((key) => (
                    <Td key={key} numeric className={key === 'CURRENT' ? 'text-ink-muted' : undefined}>
                      {Number(row.buckets[key]) > 0 ? money(row.buckets[key], data.currency) : '—'}
                    </Td>
                  ))}
                  <Td numeric className="font-semibold">
                    {money(row.buckets.total, data.currency)}
                  </Td>
                  <Td>
                    {row.contactId && supplierDocs(row.contactId).length > 0 && (
                      <Button size="sm" variant="primary" onClick={() => setPayingSupplier(row.contactId)}>
                        {t('Payer')}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
              <tr className="bg-surface-muted/60 font-semibold">
                <Td>{t('Total')}</Td>
                {BUCKETS.map((key) => (
                  <Td key={key} numeric>
                    {money(data.totals[key], data.currency)}
                  </Td>
                ))}
                <Td numeric>{money(data.totals.total, data.currency)}</Td>
                <Td />
              </tr>
            </tbody>
          </Table>
        )}
      </Card>

      {paying && <PaymentDialog open {...paying} onClose={() => setPaying(null)} />}
      {payingSupplier && supplier && (
        <SupplierPaymentDialog
          contactId={payingSupplier}
          contactName={supplier.contactName}
          currency={data!.currency}
          documents={supplierDocs(payingSupplier)}
          onClose={() => setPayingSupplier(null)}
        />
      )}
    </>
  );
}
