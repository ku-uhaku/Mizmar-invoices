'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiModules, unwrap } from '@/lib/api';
import { Card, EmptyState, ErrorNote, PageHeader, StatCard } from '@/components/ui';
import { Icon } from '@/components/icons';
import { date } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

export default function HrOverviewPage() {
  const t = useT();
  const overview = useQuery({
    queryKey: ['hr', 'overview'],
    queryFn: async () => unwrap(await apiModules.hr.overview({})),
  });
  const data = overview.data;

  return (
    <>
      <PageHeader title={t('Ressources humaines')} subtitle={t('Équipe, congés et présences')} />

      {overview.isError && <ErrorNote>{t('Chargement impossible')}</ErrorNote>}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Effectif')} value={data?.headcount ?? '—'} icon="users" href="/hr/employees" />
        <StatCard label={t('En congé aujourd’hui')} value={data?.onLeaveToday ?? '—'} icon="clock" href="/hr/leave" />
        <StatCard
          label={t('Demandes de congé en attente')}
          value={data?.pendingLeave ?? '—'}
          icon="order"
          tone={data && data.pendingLeave > 0 ? 'progress' : 'neutral'}
          href="/hr/leave"
        />
        <StatCard
          label={t('Absents aujourd’hui')}
          value={data?.absentToday ?? '—'}
          icon="alert"
          tone={data && data.absentToday > 0 ? 'danger' : 'neutral'}
          href="/hr/attendance"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t('Contrats se terminant dans 30 jours')}</h2>
          {data && data.contractsEndingSoon.length > 0 ? (
            <ul className="divide-y divide-border">
              {data.contractsEndingSoon.map((row) => (
                <li key={row.employeeId} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/hr/employees/${row.employeeId}`} className="font-medium text-ink hover:text-brand">
                    {row.employeeName}
                  </Link>
                  <span className="text-ink-muted">{date(row.endDate)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">{t('Aucun contrat n’arrive à échéance.')}</p>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t('Accès rapide')}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ['/hr/employees', 'Employés', 'users'],
              ['/hr/leave', 'Congés', 'clock'],
              ['/hr/attendance', 'Présences', 'check'],
              ['/settings/hr', 'Départements et types de congé', 'layout'],
            ].map(([href, label, icon]) => (
              <Link
                key={href}
                href={href!}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink hover:border-brand hover:text-brand"
              >
                <Icon name={icon as 'users'} className="size-4" />
                {t(label!)}
              </Link>
            ))}
          </div>
        </Card>
      </div>

      {data && data.headcount === 0 && (
        <Card className="mt-4">
          <EmptyState
            icon="users"
            title={t('Aucun employé pour l’instant')}
            description={t('Ajoutez votre équipe pour suivre les congés et les présences.')}
          />
        </Card>
      )}
    </>
  );
}
