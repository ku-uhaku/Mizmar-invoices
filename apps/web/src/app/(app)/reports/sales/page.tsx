'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { reportSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { ReportToolbar } from '@/components/report-toolbar';
import { Card, EmptyState, ErrorNote, PageHeader, Segmented, Select, Table, TableSkeleton, Td, Th } from '@/components/ui';
import { amount, money, qty } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { fetchReport, isoToday, startOfMonth } from '@/lib/reports';

type Response = z.infer<typeof reportSchemas.salesReportResponse>;
type GroupBy = 'period' | 'customer' | 'product';
type Period = 'day' | 'week' | 'month';

export default function SalesReportPage() {
  const t = useT();
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(isoToday());
  const [groupBy, setGroupBy] = useState<GroupBy>('period');
  const [period, setPeriod] = useState<Period>('day');

  const params = { from, to, groupBy, period };
  const report = useQuery({
    queryKey: ['reports', 'sales', params],
    enabled: Boolean(from && to && from <= to),
    queryFn: () => fetchReport<Response>('sales', params),
  });

  const showQty = groupBy === 'product';

  return (
    <>
      <PageHeader title={t('Rapport des ventes')} subtitle={t('Brouillons et documents annulés exclus, avoirs déduits')} />
      <ReportToolbar
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        csvPath="sales"
        csvParams={params}
      >
        <Segmented<GroupBy>
          value={groupBy}
          onChange={setGroupBy}
          options={[
            { value: 'period', label: t('Par période') },
            { value: 'customer', label: t('Par client') },
            { value: 'product', label: t('Par produit') },
          ]}
        />
        {groupBy === 'period' && (
          <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="w-36">
            <option value="day">{t('Jour')}</option>
            <option value="week">{t('Semaine')}</option>
            <option value="month">{t('Mois')}</option>
          </Select>
        )}
      </ReportToolbar>

      <Card className="overflow-hidden">
        {report.isPending ? (
          <TableSkeleton rows={6} cols={5} />
        ) : report.error ? (
          <div className="p-5">
            <ErrorNote>{(report.error as Error).message}</ErrorNote>
          </div>
        ) : report.data && report.data.rows.length > 0 ? (
          <Table className="min-w-[640px]">
            <thead>
              <tr>
                <Th>
                  {groupBy === 'period' ? t('Période') : groupBy === 'customer' ? t('Client') : t('Produit')}
                </Th>
                <Th numeric>{t('Documents')}</Th>
                {showQty && <Th numeric>{t('Quantité')}</Th>}
                <Th numeric>{t('Total HT')}</Th>
                <Th numeric>{t('TVA')}</Th>
                <Th numeric>{t('Total TTC')}</Th>
              </tr>
            </thead>
            <tbody>
              {report.data.rows.map((row) => (
                <tr key={row.key} className="hover:bg-surface-muted/60">
                  <Td>{row.label}</Td>
                  <Td numeric>{row.documentCount}</Td>
                  {showQty && <Td numeric>{qty(row.quantity)}</Td>}
                  <Td numeric>{amount(row.totalExclVat)}</Td>
                  <Td numeric>{amount(row.totalVat)}</Td>
                  <Td numeric className="font-semibold">{amount(row.totalInclVat)}</Td>
                </tr>
              ))}
              <tr className="bg-surface-muted/60 font-semibold">
                <Td>{t('Total')}</Td>
                <Td />
                {showQty && <Td />}
                <Td numeric>{money(report.data.totals.totalExclVat, report.data.currency)}</Td>
                <Td numeric>{money(report.data.totals.totalVat, report.data.currency)}</Td>
                <Td numeric>{money(report.data.totals.totalInclVat, report.data.currency)}</Td>
              </tr>
            </tbody>
          </Table>
        ) : (
          <EmptyState icon="trending" title={t('Aucune vente sur cette période')} />
        )}
      </Card>
    </>
  );
}
