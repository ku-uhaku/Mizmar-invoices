'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { apiModules, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import { PeriodFilter } from '@/components/period-filter';
import { Button, Card, EmptyState, Field, PageHeader, Select, Table, TableSkeleton, Td, Th } from '@/components/ui';
import { amount, date } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { downloadCsv, todayIso, useAccounts, yearStart } from '@/lib/use-accounting';

export default function LedgerPage() {
  return (
    <Suspense fallback={null}>
      <Ledger />
    </Suspense>
  );
}

function Ledger() {
  const t = useT();
  const params = useSearchParams();
  const accounts = useAccounts();
  const [picked, setPicked] = useState(params.get('account') ?? '');
  const [period, setPeriod] = useState({ from: yearStart(), to: todayIso() });
  const accountId = picked || accounts.data?.find((a) => a.code === '3421')?.id || accounts.data?.[0]?.id || '';

  const ledger = useQuery({
    queryKey: ['accounting', 'ledger', accountId, period],
    enabled: Boolean(accountId),
    queryFn: async () =>
      unwrap(
        await apiModules.accounting.ledger({
          query: { accountId, ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}) },
        }),
      ),
  });
  const data = ledger.data;

  function exportCsv() {
    if (!data) return;
    downloadCsv(`grand-livre-${data.account.code}.csv`, [
      ['Date', 'N°', 'Libellé', 'Débit', 'Crédit', 'Solde'],
      ['', '', 'Solde initial', '', '', data.opening],
      ...data.lines.map((l) => [l.date, String(l.seq), l.label, l.debit, l.credit, l.balance]),
    ]);
  }

  return (
    <>
      <PageHeader
        title={t('Grand livre')}
        subtitle={t('Le détail des mouvements d’un compte')}
        actions={
          <Button onClick={exportCsv} disabled={!data || data.lines.length === 0}>
            <Icon name="download" /> {t('Exporter CSV')}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={t('Compte')}>
          <Select className="w-80" value={accountId} onChange={(event) => setPicked(event.target.value)}>
            {accounts.data?.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {t(account.name)}
              </option>
            ))}
          </Select>
        </Field>
        <PeriodFilter {...period} onChange={setPeriod} />
      </div>

      <Card className="overflow-hidden">
        {ledger.isPending ? (
          <TableSkeleton rows={6} cols={5} />
        ) : !data ? null : (
          <Table className="min-w-[760px]">
            <thead>
              <tr>
                <Th>{t('Date')}</Th>
                <Th>{t('N°')}</Th>
                <Th>{t('Libellé')}</Th>
                <Th numeric>{t('Débit')}</Th>
                <Th numeric>{t('Crédit')}</Th>
                <Th numeric>{t('Solde')}</Th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-surface-muted/60 text-ink-muted">
                <Td colSpan={5}>{t('Solde initial')}</Td>
                <Td numeric>{amount(data.opening)}</Td>
              </tr>
              {data.lines.map((line, index) => (
                <tr key={`${line.entryId}-${index}`} className="hover:bg-surface-muted/60">
                  <Td className="whitespace-nowrap text-ink-muted">{date(line.date)}</Td>
                  <Td className="font-mono text-xs text-ink-subtle">{line.seq}</Td>
                  <Td>{line.label}</Td>
                  <Td numeric>{Number(line.debit) > 0 ? amount(line.debit) : ''}</Td>
                  <Td numeric>{Number(line.credit) > 0 ? amount(line.credit) : ''}</Td>
                  <Td numeric className="font-semibold">{amount(line.balance)}</Td>
                </tr>
              ))}
              <tr className="bg-surface-muted/60 font-semibold">
                <Td colSpan={3}>{t('Total de la période')}</Td>
                <Td numeric>{amount(data.debit)}</Td>
                <Td numeric>{amount(data.credit)}</Td>
                <Td numeric>{amount(data.closing)}</Td>
              </tr>
            </tbody>
          </Table>
        )}
        {data && data.lines.length === 0 && (
          <EmptyState icon="file" title={t('Aucun mouvement')} description={t('Ce compte n’a pas de mouvement sur la période.')} />
        )}
      </Card>
    </>
  );
}
