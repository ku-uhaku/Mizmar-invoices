'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { reportSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { ReportToolbar } from '@/components/report-toolbar';
import { Card, CardHeader, ErrorNote, PageHeader, Table, TableSkeleton, Td, Th } from '@/components/ui';
import { amount, money, percent } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { fetchReport, isoToday, startOfMonth } from '@/lib/reports';

type Response = z.infer<typeof reportSchemas.vatReportResponse>;
type Side = Response['sales'];

export default function VatReportPage() {
  const t = useT();
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(isoToday());

  const params = { from, to };
  const report = useQuery({
    queryKey: ['reports', 'vat', params],
    enabled: Boolean(from && to && from <= to),
    queryFn: () => fetchReport<Response>('vat', params),
  });

  const due = Number(report.data?.netVatDue ?? 0);

  return (
    <>
      <PageHeader title={t('Déclaration de TVA')} subtitle={t('Base imposable et TVA par taux, par date de facture')} />
      <ReportToolbar from={from} to={to} onFrom={setFrom} onTo={setTo} csvPath="vat" csvParams={params} />

      {report.isPending ? (
        <Card>
          <TableSkeleton rows={4} cols={3} />
        </Card>
      ) : report.error ? (
        <ErrorNote>{(report.error as Error).message}</ErrorNote>
      ) : (
        report.data && (
          <div className="space-y-4">
            <VatTable title={t('Ventes (TVA collectée)')} side={report.data.sales} currency={report.data.currency} />
            <VatTable title={t('Achats (TVA déductible)')} side={report.data.purchases} currency={report.data.currency} />
            <Card className="flex items-center justify-between p-5">
              <div>
                <p className="font-semibold text-ink">
                  {due >= 0 ? t('TVA nette à payer') : t('Crédit de TVA')}
                </p>
                <p className="text-xs text-ink-muted">{t('TVA collectée − TVA déductible')}</p>
              </div>
              <p className={`tabular text-2xl font-semibold ${due >= 0 ? 'text-ink' : 'text-positive'}`}>
                {money(report.data.netVatDue, report.data.currency)}
              </p>
            </Card>
          </div>
        )
      )}
    </>
  );
}

function VatTable({ title, side, currency }: { title: string; side: Side; currency: string }) {
  const t = useT();
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} />
      <Table>
        <thead>
          <tr>
            <Th>{t('Taux')}</Th>
            <Th numeric>{t('Base imposable')}</Th>
            <Th numeric>{t('TVA')}</Th>
          </tr>
        </thead>
        <tbody>
          {side.rows.map((row) => (
            <tr key={row.rate}>
              <Td>{percent(row.rate)}</Td>
              <Td numeric>{amount(row.base)}</Td>
              <Td numeric>{amount(row.vat)}</Td>
            </tr>
          ))}
          <tr className="bg-surface-muted/60 font-semibold">
            <Td>{t('Total')}</Td>
            <Td numeric>{money(side.totalBase, currency)}</Td>
            <Td numeric>{money(side.totalVat, currency)}</Td>
          </tr>
        </tbody>
      </Table>
    </Card>
  );
}
