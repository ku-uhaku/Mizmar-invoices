'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { reportSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { ReportToolbar } from '@/components/report-toolbar';
import { Card, EmptyState, ErrorNote, PageHeader, Select, Table, TableSkeleton, Td, Th } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { amount, money, qty } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { fetchReport } from '@/lib/reports';

type Response = z.infer<typeof reportSchemas.stockValuationResponse>;

export default function StockValuationPage() {
  const t = useT();
  const [warehouseId, setWarehouseId] = useState('');

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => unwrap(await api.inventory.listWarehouses()),
  });

  const params = { warehouseId: warehouseId || undefined };
  const report = useQuery({
    queryKey: ['reports', 'stock-valuation', params],
    queryFn: () => fetchReport<Response>('stock-valuation', params),
  });

  return (
    <>
      <PageHeader title={t('Valorisation du stock')} subtitle={t('Quantité en stock × coût moyen pondéré')} />
      <ReportToolbar hideRange csvPath="stock-valuation" csvParams={params}>
        <label className="block min-w-56">
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">{t('Entrepôt')}</span>
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">{t('Tous les entrepôts')}</option>
            {warehouses.data?.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} — {warehouse.name}
              </option>
            ))}
          </Select>
        </label>
      </ReportToolbar>

      <Card className="overflow-hidden">
        {report.isPending ? (
          <TableSkeleton rows={6} cols={6} />
        ) : report.error ? (
          <div className="p-5">
            <ErrorNote>{(report.error as Error).message}</ErrorNote>
          </div>
        ) : report.data && report.data.rows.length > 0 ? (
          <Table className="min-w-[760px]">
            <thead>
              <tr>
                <Th>{t('Entrepôt')}</Th>
                <Th>{t('Article')}</Th>
                <Th numeric>{t('En stock')}</Th>
                <Th numeric>{t('Coût moyen')}</Th>
                <Th numeric>{t('Valeur')}</Th>
              </tr>
            </thead>
            <tbody>
              {report.data.rows.map((row) => (
                <tr key={`${row.warehouseCode}-${row.variantId}`} className="hover:bg-surface-muted/60">
                  <Td className="text-ink-muted">{row.warehouseCode}</Td>
                  <Td>
                    <span className="font-medium">{row.productName}</span>
                    <div className="text-xs text-ink-subtle">
                      {row.sku}
                      {row.variantLabel ? ` · ${row.variantLabel}` : ''}
                    </div>
                  </Td>
                  <Td numeric>{qty(row.onHand)}</Td>
                  <Td numeric>{amount(row.averageCost)}</Td>
                  <Td numeric className="font-semibold">{amount(row.value)}</Td>
                </tr>
              ))}
              {report.data.warehouseTotals.length > 1 &&
                report.data.warehouseTotals.map((total) => (
                  <tr key={total.warehouseCode} className="bg-surface-muted/40">
                    <Td colSpan={4} className="text-ink-muted">
                      {t('Sous-total')} {total.warehouseCode} — {total.warehouseName}
                    </Td>
                    <Td numeric>{amount(total.value)}</Td>
                  </tr>
                ))}
              <tr className="bg-surface-muted/60 font-semibold">
                <Td colSpan={4}>{t('Valeur totale du stock')}</Td>
                <Td numeric>{money(report.data.totalValue, report.data.currency)}</Td>
              </tr>
            </tbody>
          </Table>
        ) : (
          <EmptyState icon="box" title={t('Aucun stock à valoriser')} />
        )}
      </Card>
    </>
  );
}
