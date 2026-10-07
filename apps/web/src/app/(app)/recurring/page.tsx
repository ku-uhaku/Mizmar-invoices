'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import { RecurringFormDialog, type RecurringSchedule } from '@/components/recurring-form';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  PageHeader,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { date, dateTime } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

const FREQUENCY_LABEL = {
  WEEKLY: 'Hebdomadaire',
  MONTHLY: 'Mensuelle',
  QUARTERLY: 'Trimestrielle',
  YEARLY: 'Annuelle',
} as const;

const MODE_LABEL = {
  DRAFT: 'Brouillon',
  VALIDATE: 'Valider',
  VALIDATE_AND_EMAIL: 'Valider et envoyer par e-mail',
} as const;

export default function RecurringPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RecurringSchedule | 'new' | null>(null);
  const [history, setHistory] = useState<RecurringSchedule | null>(null);

  const list = useQuery({
    queryKey: ['recurring'],
    queryFn: async () => unwrap(await api.recurring.list()),
  });

  const onError = (cause: unknown) =>
    toast.error(cause instanceof ApiError ? cause.message : t('Action impossible'));
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['recurring'] });
    void queryClient.invalidateQueries({ queryKey: ['recurring-runs'] });
  };

  const toggle = useMutation({
    mutationFn: async (schedule: RecurringSchedule) =>
      schedule.isActive
        ? unwrap(await api.recurring.pause({ params: { id: schedule.id }, body: {} }))
        : unwrap(await api.recurring.resume({ params: { id: schedule.id }, body: {} })),
    onSuccess: (schedule) => {
      refresh();
      toast.success(schedule.isActive ? t('Facture récurrente reprise') : t('Facture récurrente en pause'));
    },
    onError,
  });

  const runNow = useMutation({
    mutationFn: async (schedule: RecurringSchedule) =>
      unwrap(await api.recurring.runNow({ params: { id: schedule.id }, body: {} })),
    onSuccess: (run) => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      if (run.status === 'OK') toast.success(t('Facture générée'));
      else toast.error(run.error ?? t('Échec de la génération'));
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: async (schedule: RecurringSchedule) =>
      unwrap(await api.recurring.remove({ params: { id: schedule.id } })),
    onSuccess: () => {
      refresh();
      toast.success(t('Facture récurrente supprimée'));
    },
    onError,
  });

  return (
    <>
      <PageHeader
        title={t('Factures récurrentes')}
        subtitle={t('Générées automatiquement à chaque échéance')}
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> {t('Nouvelle facture récurrente')}
          </Button>
        }
      />

      <Card className="overflow-hidden">
        {list.isPending ? (
          <TableSkeleton rows={4} cols={6} />
        ) : list.data && list.data.length > 0 ? (
          <Table className="min-w-[880px]">
            <thead>
              <tr>
                <Th>{t('Nom')}</Th>
                <Th>{t('Client')}</Th>
                <Th>{t('Fréquence')}</Th>
                <Th>{t('Prochaine échéance')}</Th>
                <Th>{t('Dernière exécution')}</Th>
                <Th>{t('État')}</Th>
                <Th className="w-72" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((schedule) => (
                <tr key={schedule.id} className="hover:bg-surface-muted/60">
                  <Td className="font-medium">
                    {schedule.name}
                    <div className="text-xs text-ink-subtle">{t(MODE_LABEL[schedule.mode])}</div>
                  </Td>
                  <Td>{schedule.contactName}</Td>
                  <Td className="text-ink-muted">
                    {schedule.interval > 1 ? `×${schedule.interval} ` : ''}
                    {t(FREQUENCY_LABEL[schedule.frequency])}
                  </Td>
                  <Td>{date(schedule.nextRunAt)}</Td>
                  <Td className="text-ink-muted">{dateTime(schedule.lastRunAt)}</Td>
                  <Td>
                    {schedule.isCompleted ? (
                      <Badge>{t('Terminée')}</Badge>
                    ) : schedule.isActive ? (
                      <Badge tone="success">{t('Active')}</Badge>
                    ) : (
                      <Badge tone="progress">{t('En pause')}</Badge>
                    )}
                    {schedule.consecutiveFailures > 0 && (
                      <Badge tone="danger" className="ms-1">
                        {t('{n} échec(s)', { n: schedule.consecutiveFailures })}
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={schedule.isCompleted}
                        loading={runNow.isPending && runNow.variables?.id === schedule.id}
                        onClick={() => runNow.mutate(schedule)}
                      >
                        {t('Exécuter maintenant')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={toggle.isPending && toggle.variables?.id === schedule.id}
                        onClick={() => toggle.mutate(schedule)}
                      >
                        {schedule.isActive ? t('Mettre en pause') : t('Reprendre')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setHistory(schedule)}>
                        {t('Historique')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(schedule)}>
                        {t('Modifier')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (window.confirm(t('Supprimer cette facture récurrente ? Les factures déjà générées sont conservées.'))) {
                            remove.mutate(schedule);
                          }
                        }}
                      >
                        {t('Supprimer')}
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon="clock"
            title={t('Aucune facture récurrente')}
            description={t('Planifiez vos abonnements et loyers : la facture est créée toute seule à chaque échéance.')}
            action={
              <Button variant="primary" onClick={() => setEditing('new')}>
                <Icon name="plus" /> {t('Nouvelle facture récurrente')}
              </Button>
            }
          />
        )}
      </Card>

      {editing && (
        <RecurringFormDialog
          key={editing === 'new' ? 'new' : editing.id}
          schedule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {history && <RunsDialog schedule={history} onClose={() => setHistory(null)} />}
    </>
  );
}

function RunsDialog({ schedule, onClose }: { schedule: RecurringSchedule; onClose: () => void }) {
  const t = useT();
  const runs = useQuery({
    queryKey: ['recurring-runs', schedule.id],
    queryFn: async () => unwrap(await api.recurring.runs({ params: { id: schedule.id } })),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="lg"
      title={t('Historique : {name}', { name: schedule.name })}
      footer={<Button onClick={onClose}>{t('Fermer')}</Button>}
    >
      {runs.isPending ? (
        <TableSkeleton rows={3} cols={4} />
      ) : runs.data && runs.data.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <Th>{t('Échéance')}</Th>
              <Th>{t('Exécutée le')}</Th>
              <Th>{t('Résultat')}</Th>
              <Th>{t('Facture')}</Th>
            </tr>
          </thead>
          <tbody>
            {runs.data.map((run) => (
              <tr key={run.id}>
                <Td>{date(run.scheduledFor)}</Td>
                <Td className="text-ink-muted">{dateTime(run.runAt)}</Td>
                <Td>
                  <Badge tone={run.status === 'OK' ? (run.error ? 'progress' : 'success') : 'danger'}>
                    {run.status === 'OK' ? t('Générée') : t('Échec')}
                  </Badge>
                  {run.error && <div className="mt-1 max-w-xs text-xs text-ink-muted">{run.error}</div>}
                </Td>
                <Td>
                  {run.documentId ? (
                    <Link href={`/documents/${run.documentId}`} className="text-brand hover:underline">
                      {run.documentNumber ?? t('Brouillon')}
                    </Link>
                  ) : (
                    '—'
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="py-6 text-center text-sm text-ink-muted">{t('Aucune exécution pour le moment.')}</p>
      )}
    </Dialog>
  );
}
