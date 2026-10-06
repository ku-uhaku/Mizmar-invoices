'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import { COUNT_STATUS, StockTabs } from '@/components/stock-tabs';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
} from '@/components/ui';
import { dateTime } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

export default function CountsPage() {
  const t = useT();
  const [newOpen, setNewOpen] = useState(false);

  const sessions = useQuery({
    queryKey: ['count-sessions'],
    queryFn: async () => unwrap(await api.inventory.listCountSessions({ query: {} })),
  });

  return (
    <>
      <PageHeader
        title={t('Stock')}
        subtitle={t('Sessions d’inventaire physique')}
        actions={
          <Button variant="primary" onClick={() => setNewOpen(true)}>
            <Icon name="plus" /> {t('Nouvel inventaire')}
          </Button>
        }
      />
      <StockTabs />

      <Card className="overflow-hidden">
        {sessions.isPending ? (
          <TableSkeleton rows={5} cols={6} />
        ) : sessions.data && sessions.data.length > 0 ? (
          <Table className="min-w-[720px]">
            <thead>
              <tr>
                <Th>{t('Référence')}</Th>
                <Th>{t('Entrepôt')}</Th>
                <Th>{t('Statut')}</Th>
                <Th>{t('Démarré le')}</Th>
                <Th>{t('Par')}</Th>
                <Th numeric>{t('Lignes')}</Th>
                <Th numeric>{t('Écarts')}</Th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.map((session) => {
                const status = COUNT_STATUS[session.status] ?? {
                  tone: 'neutral' as const,
                  label: session.status,
                };
                return (
                  <tr key={session.id} className="hover:bg-surface-muted/60">
                    <Td>
                      <Link
                        href={`/stock/counts/${session.id}`}
                        className="font-semibold text-brand hover:underline"
                      >
                        {session.reference}
                      </Link>
                    </Td>
                    <Td>{session.warehouseName}</Td>
                    <Td>
                      <Badge tone={status.tone}>{t(status.label)}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-muted">{dateTime(session.startedAt)}</Td>
                    <Td className="text-ink-muted">{session.startedByName ?? '—'}</Td>
                    <Td numeric>{session.lines.length}</Td>
                    <Td numeric className={session.varianceCount > 0 ? 'font-semibold text-danger' : ''}>
                      {session.varianceCount}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon="clock"
            title={t('Aucun inventaire pour l’instant')}
            description={t('Lancez un inventaire pour comparer le stock réel au stock théorique.')}
            action={
              <Button variant="primary" onClick={() => setNewOpen(true)}>
                <Icon name="plus" /> {t('Nouvel inventaire')}
              </Button>
            }
          />
        )}
      </Card>

      {newOpen && <NewCountDialog onClose={() => setNewOpen(false)} />}
    </>
  );
}

function NewCountDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState('');
  const [isBlind, setIsBlind] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => unwrap(await api.inventory.listWarehouses()),
  });
  const active = warehouses.data?.filter((warehouse) => warehouse.isActive) ?? [];
  const effective = warehouseId || active[0]?.id || '';

  const create = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await api.inventory.createCountSession({
          body: { warehouseId: effective, isBlind, note: note.trim() || undefined },
        }),
      );
    },
    onSuccess: (session) => router.push(`/stock/counts/${session.id}`),
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Création impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('Nouvel inventaire')}
      description={t('Le stock théorique est figé au moment de la création.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!effective}
            onClick={() => create.mutate()}
          >
            {t('Démarrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNote>{error}</ErrorNote>
        <Field label={t('Entrepôt')} required>
          <Select value={effective} onChange={(event) => setWarehouseId(event.target.value)}>
            {active.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} — {warehouse.name}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <Checkbox
            checked={isBlind}
            onChange={(event) => setIsBlind(event.target.checked)}
            label={t('Inventaire à l’aveugle')}
          />
          <p className="ms-6 mt-0.5 text-xs text-ink-muted">
            {t('Les quantités théoriques sont masquées pendant le comptage.')}
          </p>
        </div>
        <Field label={t('Note')}>
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
