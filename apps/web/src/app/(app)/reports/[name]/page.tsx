'use client';

import { useQuery } from '@tanstack/react-query';
import { notFound, useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { reportSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { ReportChart } from '@/components/charts';
import { ReportToolbar } from '@/components/report-toolbar';
import {
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Segmented,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
} from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { amount, date, money, qty } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { REPORT_DEF_BY_NAME } from '@/lib/report-defs';
import { fetchReport, isoToday } from '@/lib/reports';

type Response = z.infer<typeof reportSchemas.tableReportResponse>;
type Column = Response['columns'][number];
type Period = 'day' | 'week' | 'month';

const startOfYear = () => `${new Date().getFullYear()}-01-01`;

/** One view for every generic table report: filters, chart, table, CSV. */
export default function TableReportPage() {
  const t = useT();
  const { name } = useParams<{ name: string }>();
  const def = REPORT_DEF_BY_NAME.get(name);
  if (!def) notFound();

  const [from, setFrom] = useState(def.period === 'day' ? `${isoToday().slice(0, 8)}01` : startOfYear());
  const [to, setTo] = useState(isoToday());
  const [groupBy, setGroupBy] = useState(def.groupBy?.[0]?.value ?? '');
  const [period, setPeriod] = useState<Period>(def.period ?? 'month');
  const [warehouseId, setWarehouseId] = useState('');
  const [days, setDays] = useState('90');

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    enabled: Boolean(def.warehouse),
    queryFn: async () => unwrap(await api.inventory.listWarehouses()),
  });

  const params: Record<string, string | undefined> = {
    ...(def.asOf ? {} : { from, to }),
    groupBy: groupBy || undefined,
    period: def.period ? period : undefined,
    warehouseId: warehouseId || undefined,
    days: def.days ? days : undefined,
  };
  const report = useQuery({
    queryKey: ['reports', name, params],
    enabled: def.asOf || Boolean(from && to && from <= to),
    queryFn: () => fetchReport<Response>(name, params),
  });

  const cell = (column: Column, value: string | number | null): string => {
    if (value === null || value === undefined || value === '') return '—';
    const text = String(value);
    switch (column.type) {
      case 'money':
        return money(text, report.data?.currency);
      case 'qty':
        return qty(text);
      case 'int':
        return amount(text).replace(/[.,]00$/, '');
      case 'percent':
        return `${amount(text)} %`;
      case 'date':
        return date(text);
      case 'label':
        return t(text);
      default:
        return text;
    }
  };

  const chart = useMemo(() => {
    const spec = def.chart;
    const data = report.data;
    if (!spec || !data || data.rows.length === 0) return null;
    const labelColumn = data.columns.find((column) => column.key === spec.x);
    const seriesColumns =
      spec.series === 'money'
        ? data.columns.filter((column) => column.type === 'money' && !(spec.skip ?? []).includes(column.key))
        : spec.series
            .map((key) => data.columns.find((column) => column.key === key))
            .filter((column): column is Column => Boolean(column));
    if (seriesColumns.length === 0) return null;
    const rows = data.rows.slice(0, spec.kind === 'donut' ? 50 : 24).map((row) => {
      const point: Record<string, string | number> = {
        [spec.x]: labelColumn?.type === 'label' ? t(String(row[spec.x] ?? '')) : String(row[spec.x] ?? ''),
      };
      for (const column of seriesColumns) point[column.key] = Number(row[column.key] ?? 0);
      return point;
    });
    return {
      kind: spec.kind,
      xKey: spec.x,
      rows,
      series: seriesColumns.map((column) => ({ key: column.key, label: t(column.label) })),
    };
  }, [def.chart, report.data, t]);

  return (
    <>
      <PageHeader title={t(def.title)} subtitle={t(def.description)} />
      <ReportToolbar
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        csvPath={name}
        csvParams={params}
        hideRange={def.asOf}
      >
        {def.groupBy && (
          <Segmented<string>
            value={groupBy}
            onChange={setGroupBy}
            options={def.groupBy.map((option) => ({ value: option.value, label: t(option.label) }))}
          />
        )}
        {def.period && (def.groupBy === undefined || groupBy === 'period') && (
          <Select value={period} onChange={(event) => setPeriod(event.target.value as Period)} className="w-36">
            <option value="day">{t('Jour')}</option>
            <option value="week">{t('Semaine')}</option>
            <option value="month">{t('Mois')}</option>
          </Select>
        )}
        {def.warehouse && (
          <Select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="w-48">
            <option value="">{t('Tous les entrepôts')}</option>
            {warehouses.data?.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </Select>
        )}
        {def.days && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">{t('Sans vente depuis (jours)')}</span>
            <Select value={days} onChange={(event) => setDays(event.target.value)} className="w-36">
              {['30', '60', '90', '180', '365'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </label>
        )}
      </ReportToolbar>

      {chart && (
        <Card className="mb-4 p-4">
          <ReportChart
            kind={chart.kind}
            data={chart.rows}
            xKey={chart.xKey}
            series={chart.series}
            format={(value) => money(value.toFixed(2), report.data?.currency)}
            other={t('Autres')}
          />
        </Card>
      )}

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
                {report.data.columns.map((column) => (
                  <Th key={column.key} numeric={['money', 'qty', 'int', 'percent'].includes(column.type)}>
                    {t(column.label)}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.data.rows.map((row, index) => (
                <tr key={index} className="hover:bg-surface-muted/60">
                  {report.data.columns.map((column) => (
                    <Td
                      key={column.key}
                      numeric={['money', 'qty', 'int', 'percent'].includes(column.type)}
                      className={column.type === 'date' ? 'whitespace-nowrap text-ink-muted' : undefined}
                    >
                      {cell(column, row[column.key] ?? null)}
                    </Td>
                  ))}
                </tr>
              ))}
              {report.data.totals && (
                <tr className="bg-surface-muted/60 font-semibold">
                  {report.data.columns.map((column) => (
                    <Td key={column.key} numeric={['money', 'qty', 'int', 'percent'].includes(column.type)}>
                      {cell(column, report.data.totals?.[column.key] ?? null)}
                    </Td>
                  ))}
                </tr>
              )}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon="file"
            title={t('Aucune donnée sur cette période')}
            description={t('Modifiez la période ou les filtres.')}
          />
        )}
      </Card>
    </>
  );
}
