'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { reportSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { ReportToolbar } from '@/components/report-toolbar';
import { Card, EmptyState, ErrorNote, PageHeader, Segmented, Select, Table, TableSkeleton, Td, Th } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { amount, date, money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { fetchReport, isoToday } from '@/lib/reports';

type Response = z.infer<typeof reportSchemas.statementReportResponse>;
type Party = 'customer' | 'supplier';

function startOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

export default function StatementsReportPage() {
  const t = useT();
  const [party, setParty] = useState<Party>('customer');
  const [contactId, setContactId] = useState('');
  const [from, setFrom] = useState(startOfYear());
  const [to, setTo] = useState(isoToday());

  const contacts = useQuery({
    queryKey: ['contacts', 'picker', party],
    queryFn: async () =>
      unwrap(
        await api.contacts.list({
          query: { kind: party === 'customer' ? 'CLIENT' : 'SUPPLIER', isActive: true, limit: 200 },
        }),
      ),
  });

  const params = { contactId, party, from, to };
  const report = useQuery({
    queryKey: ['reports', 'statement', params],
    enabled: Boolean(contactId && from && to && from <= to),
    queryFn: () => fetchReport<Response>('statement', params),
  });

  return (
    <>
      <PageHeader title={t('Relevé de compte')} subtitle={t('Documents, paiements et solde courant')} />
      <ReportToolbar
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        csvPath="statement"
        csvParams={params}
      >
        <Segmented<Party>
          value={party}
          onChange={(value) => {
            setParty(value);
            setContactId('');
          }}
          options={[
            { value: 'customer', label: t('Client') },
            { value: 'supplier', label: t('Fournisseur') },
          ]}
        />
        <label className="block min-w-56">
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">{t('Tiers')}</span>
          <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">{t('Choisir…')}</option>
            {contacts.data?.items.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.displayName}
              </option>
            ))}
          </Select>
        </label>
      </ReportToolbar>

      <Card className="overflow-hidden">
        {!contactId ? (
          <EmptyState icon="users" title={t('Choisissez un tiers pour afficher son relevé')} />
        ) : report.isPending ? (
          <TableSkeleton rows={6} cols={6} />
        ) : report.error ? (
          <div className="p-5">
            <ErrorNote>{(report.error as Error).message}</ErrorNote>
          </div>
        ) : (
          report.data && (
            <Table className="min-w-[760px]">
              <thead>
                <tr>
                  <Th>{t('Date')}</Th>
                  <Th>{t('Référence')}</Th>
                  <Th>{t('Libellé')}</Th>
                  <Th numeric>{t('Débit')}</Th>
                  <Th numeric>{t('Crédit')}</Th>
                  <Th numeric>{t('Solde')}</Th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-surface-muted/40">
                  <Td>{date(report.data.from)}</Td>
                  <Td />
                  <Td className="text-ink-muted">{t('Solde d’ouverture')}</Td>
                  <Td />
                  <Td />
                  <Td numeric className="font-medium">{amount(report.data.openingBalance)}</Td>
                </tr>
                {report.data.rows.map((row, index) => (
                  <tr key={index} className="hover:bg-surface-muted/60">
                    <Td className="whitespace-nowrap text-ink-muted">{date(row.date)}</Td>
                    <Td>{row.reference || '—'}</Td>
                    <Td className="text-ink-muted">{row.label}</Td>
                    <Td numeric>{Number(row.debit) ? amount(row.debit) : ''}</Td>
                    <Td numeric>{Number(row.credit) ? amount(row.credit) : ''}</Td>
                    <Td numeric className="font-medium">{amount(row.balance)}</Td>
                  </tr>
                ))}
                <tr className="bg-surface-muted/60 font-semibold">
                  <Td colSpan={3}>{t('Solde de clôture')}</Td>
                  <Td numeric>{amount(report.data.totalDebit)}</Td>
                  <Td numeric>{amount(report.data.totalCredit)}</Td>
                  <Td numeric>{money(report.data.closingBalance, report.data.currency)}</Td>
                </tr>
              </tbody>
            </Table>
          )
        )}
      </Card>
    </>
  );
}
