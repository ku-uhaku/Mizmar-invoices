'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiModules, unwrap } from '@/lib/api';
import {
  Badge,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Segmented,
  Table,
  TableSkeleton,
  Td,
  Th,
} from '@/components/ui';
import { dateTime, money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { usePosSettings } from '@/lib/use-pos';

type Filter = 'ALL' | 'OPEN' | 'CLOSED';

export default function CashSessionsPage() {
  const t = useT();
  const router = useRouter();
  const pos = usePosSettings();
  const [status, setStatus] = useState<Filter>('ALL');

  const sessions = useQuery({
    queryKey: ['cash', 'sessions', status],
    queryFn: async () =>
      unwrap(await apiModules.cash.listSessions({ query: { limit: 100, ...(status === 'ALL' ? {} : { status }) } })),
  });

  return (
    <>
      <PageHeader
        title={t('Sessions de caisse')}
        subtitle={t('Ouvertures, clôtures et écarts de caisse')}
        actions={
          <>
            <Link href="/reports/cash-sessions" className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink">
              {t('Rapport')}
            </Link>
            <Link href="/pos" className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong">
              {t('Aller à la caisse')}
            </Link>
          </>
        }
      />

      <div className="mb-3">
        <Segmented<Filter>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'ALL', label: t('Toutes') },
            { value: 'OPEN', label: t('Ouvertes') },
            { value: 'CLOSED', label: t('Clôturées') },
          ]}
        />
      </div>

      <Card className="overflow-hidden">
        {sessions.isPending ? (
          <TableSkeleton rows={5} cols={7} />
        ) : sessions.isError ? (
          <ErrorNote>{t('Chargement impossible')}</ErrorNote>
        ) : sessions.data.length > 0 ? (
          <Table className="min-w-[860px]">
            <thead>
              <tr>
                <Th>{t('Caisse')}</Th>
                <Th>{t('Ouverture')}</Th>
                <Th>{t('Caissier')}</Th>
                <Th>{t('Statut')}</Th>
                <Th numeric>{t('Ventes')}</Th>
                <Th numeric>{t('Espèces attendues')}</Th>
                <Th numeric>{t('Écart')}</Th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.map((session) => {
                const diff = session.difference ? Number(session.difference) : null;
                return (
                  <tr
                    key={session.id}
                    className="cursor-pointer hover:bg-surface-muted/60"
                    onClick={() => router.push(`/pos/sessions/${session.id}`)}
                  >
                    <Td className="font-medium">
                      {session.registerName} <span className="text-ink-muted">#{session.number}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-muted">{dateTime(session.openedAt)}</Td>
                    <Td className="text-ink-muted">{session.openedByName}</Td>
                    <Td>
                      <Badge tone={session.status === 'OPEN' ? 'info' : 'neutral'}>
                        {session.status === 'OPEN' ? t('Ouverte') : t('Clôturée')}
                      </Badge>
                    </Td>
                    <Td numeric>
                      {money(session.salesTotal, pos.currency)}{' '}
                      <span className="text-ink-muted">({session.salesCount})</span>
                    </Td>
                    <Td numeric>{money(session.expectedCash, pos.currency)}</Td>
                    <Td
                      numeric
                      className={diff === null ? 'text-ink-muted' : Math.abs(diff) < 0.005 ? 'text-positive' : 'font-semibold text-danger'}
                    >
                      {diff === null ? '—' : money(session.difference, pos.currency)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon="clock" title={t('Aucune session de caisse')} description={t('Ouvrez la caisse pour démarrer une session.')} />
        )}
      </Card>
    </>
  );
}
