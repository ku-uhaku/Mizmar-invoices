'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { apiModules, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import { PeriodFilter } from '@/components/period-filter';
import { Badge, Button, Card, EmptyState, PageHeader, StatCard, Table, TableSkeleton, Td, Th } from '@/components/ui';
import { amount, money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { downloadCsv, todayIso, yearStart } from '@/lib/use-accounting';

const TYPE_LABEL = {
  ASSET: 'Comptes d’actif',
  LIABILITY: 'Comptes de passif',
  EQUITY: 'Capitaux propres',
  INCOME: 'Produits',
  EXPENSE: 'Charges',
} as const;

export default function TrialBalancePage() {
  const t = useT();
  const [period, setPeriod] = useState({ from: yearStart(), to: todayIso() });

  const report = useQuery({
    queryKey: ['accounting', 'trial-balance', period],
    queryFn: async () =>
      unwrap(
        await apiModules.accounting.trialBalance({
          query: { ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}) },
        }),
      ),
  });
  const data = report.data;

  function exportCsv() {
    if (!data) return;
    downloadCsv(`balance-${period.from}-${period.to}.csv`, [
      ['Compte', 'Intitulé', 'Solde initial', 'Débit', 'Crédit', 'Solde final'],
      ...data.rows.map((row) => [row.code, row.name, row.opening, row.debit, row.credit, row.closing]),
      ['', 'Total', '', data.totals.debit, data.totals.credit, ''],
    ]);
  }

  return (
    <>
      <PageHeader
        title={t('Balance générale')}
        subtitle={t('Mouvements et soldes de chaque compte sur la période')}
        actions={
          <Button onClick={exportCsv} disabled={!data || data.rows.length === 0}>
            <Icon name="download" /> {t('Exporter CSV')}
          </Button>
        }
      />

      <div className="mb-4">
        <PeriodFilter {...period} onChange={setPeriod} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('Produits')} value={money(data?.result.income ?? '0')} icon="trending" tone="success" />
        <StatCard label={t('Charges')} value={money(data?.result.expense ?? '0')} icon="cart" tone="progress" />
        <StatCard
          label={t('Résultat')}
          value={money(data?.result.net ?? '0')}
          icon="wallet"
          tone={Number(data?.result.net ?? 0) >= 0 ? 'success' : 'danger'}
        />
        <StatCard
          label={t('Équilibre')}
          value={data ? (data.balanced ? t('Équilibrée') : t('Déséquilibrée')) : '—'}
          icon={data?.balanced === false ? 'alert' : 'check'}
          tone={data?.balanced === false ? 'danger' : 'success'}
        />
      </div>

      <Card className="overflow-hidden">
        {report.isPending ? (
          <TableSkeleton rows={8} cols={6} />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState icon="file" title={t('Aucune écriture')} description={t('Aucun mouvement sur cette période.')} />
        ) : (
          <Table className="min-w-[860px]">
            <thead>
              <tr>
                <Th>{t('Compte')}</Th>
                <Th>{t('Intitulé')}</Th>
                <Th>{t('Type')}</Th>
                <Th numeric>{t('Solde initial')}</Th>
                <Th numeric>{t('Débit')}</Th>
                <Th numeric>{t('Crédit')}</Th>
                <Th numeric>{t('Solde final')}</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.accountId} className="hover:bg-surface-muted/60">
                  <Td className="font-mono text-sm">
                    <Link href={`/accounting/ledger?account=${row.accountId}`} className="text-brand hover:underline">
                      {row.code}
                    </Link>
                  </Td>
                  <Td className="font-medium">{t(row.name)}</Td>
                  <Td>
                    <Badge>{t(TYPE_LABEL[row.type])}</Badge>
                  </Td>
                  <Td numeric className="text-ink-muted">{amount(row.opening)}</Td>
                  <Td numeric>{amount(row.debit)}</Td>
                  <Td numeric>{amount(row.credit)}</Td>
                  <Td numeric className="font-semibold">{amount(row.closing)}</Td>
                </tr>
              ))}
              <tr className="bg-surface-muted/60 font-semibold">
                <Td />
                <Td>{t('Total')}</Td>
                <Td />
                <Td />
                <Td numeric>{amount(data.totals.debit)}</Td>
                <Td numeric>{amount(data.totals.credit)}</Td>
                <Td />
              </tr>
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-xs text-ink-subtle">
        {t('Solde final : positif = débiteur, négatif = créditeur.')}
      </p>
    </>
  );
}
