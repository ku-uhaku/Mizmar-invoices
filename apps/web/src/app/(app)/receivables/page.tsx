'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  PageHeader,
  Segmented,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { date, dateTime, money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

type Tab = 'overdue' | 'ageing';
type Bucket = 'ALL' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_PLUS';

const BUCKET_LABELS: Record<string, string> = {
  CURRENT: 'Non échu',
  D1_30: '1-30 jours',
  D31_60: '31-60 jours',
  D61_90: '61-90 jours',
  D90_PLUS: '90+ jours',
};

const BUCKET_TONE: Record<string, 'neutral' | 'info' | 'progress' | 'danger'> = {
  CURRENT: 'neutral',
  D1_30: 'info',
  D31_60: 'progress',
  D61_90: 'danger',
  D90_PLUS: 'danger',
};

export default function ReceivablesPage() {
  return (
    <Suspense fallback={null}>
      <Receivables />
    </Suspense>
  );
}

function Check(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      {...props}
      className="size-4 rounded border-border-strong text-brand focus:ring-brand/30"
    />
  );
}

function Receivables() {
  const t = useT();
  const queryClient = useQueryClient();
  const contactId = useSearchParams().get('contactId') ?? undefined;
  const [tab, setTab] = useState<Tab>('overdue');
  const [bucket, setBucket] = useState<Bucket>('ALL');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [forceIds, setForceIds] = useState<string[] | null>(null);

  const overdue = useQuery({
    queryKey: ['receivables', 'overdue', contactId, bucket],
    queryFn: async () =>
      unwrap(
        await api.receivables.overdue({
          query: { contactId, ...(bucket !== 'ALL' ? { bucket } : {}) },
        }),
      ),
  });

  const ageing = useQuery({
    queryKey: ['receivables', 'ageing'],
    enabled: tab === 'ageing',
    queryFn: async () => unwrap(await api.receivables.ageing()),
  });

  const remind = useMutation({
    mutationFn: async (input: { documentIds: string[]; force: boolean }) =>
      unwrap(await api.receivables.remind({ body: { ...input, attachPdf: true } })),
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['receivables'] });
      void queryClient.invalidateQueries({ queryKey: ['reminders'] });
      setSelected(new Set());

      const recent = data.results.filter((r) => r.outcome === 'SKIPPED_RECENT');
      const noEmail = data.results.filter((r) => r.outcome === 'NO_EMAIL').length;
      const failed = data.results.filter((r) => r.outcome === 'FAILED');

      if (data.sent > 0) toast.success(t('{n} relance(s) envoyée(s)', { n: data.sent }));
      if (noEmail > 0) toast.error(t('{n} client(s) sans adresse email', { n: noEmail }));
      if (failed.length > 0) toast.error(failed[0]?.message ?? t('Envoi impossible'));
      if (recent.length > 0 && !variables.force) setForceIds(recent.map((r) => r.documentId));
      else setForceIds(null);
    },
    onError: (cause) =>
      toast.error(cause instanceof ApiError ? cause.message : t('Envoi impossible')),
  });

  const items = overdue.data?.items ?? [];
  const currency = overdue.data?.currency ?? 'MAD';
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.documentId));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <PageHeader
        title={t('Créances')}
        subtitle={
          overdue.data
            ? t('{n} facture(s) en retard — {total}', {
                n: items.length,
                total: money(overdue.data.totalOutstanding, currency),
              })
            : t('Factures de vente échues et balance âgée')
        }
        actions={
          tab === 'overdue' && selected.size > 0 ? (
            <Button
              variant="primary"
              loading={remind.isPending}
              onClick={() => remind.mutate({ documentIds: [...selected], force: false })}
            >
              <Icon name="mail" />
              {t('Relancer la sélection ({n})', { n: selected.size })}
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overdue', label: t('Factures en retard') },
            { value: 'ageing', label: t('Balance âgée') },
          ]}
        />
        {tab === 'overdue' && (
          <Segmented<Bucket>
            value={bucket}
            onChange={setBucket}
            options={[
              { value: 'ALL', label: t('Tous') },
              ...(['D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const).map((value) => ({
                value,
                label: t(BUCKET_LABELS[value]!),
              })),
            ]}
          />
        )}
        {contactId && (
          <Link href="/receivables" className="text-xs text-brand hover:underline">
            {t('Retirer le filtre client')}
          </Link>
        )}
      </div>

      {tab === 'overdue' ? (
        <Card className="overflow-hidden">
          {overdue.isPending ? (
            <TableSkeleton rows={6} cols={8} />
          ) : items.length === 0 ? (
            <EmptyState
              icon="check"
              title={t('Aucune facture en retard')}
              description={t('Tous les clients sont à jour de leurs paiements.')}
            />
          ) : (
            <Table className="min-w-[960px]">
              <thead>
                <tr>
                  <Th className="w-10">
                    <Check
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(items.map((i) => i.documentId)))
                      }
                      aria-label={t('Tout sélectionner')}
                    />
                  </Th>
                  <Th>{t('Facture')}</Th>
                  <Th>{t('Client')}</Th>
                  <Th>{t('Échéance')}</Th>
                  <Th>{t('Retard')}</Th>
                  <Th numeric>{t('Reste dû')}</Th>
                  <Th>{t('Relances')}</Th>
                  <Th className="w-28" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.documentId} className="hover:bg-surface-muted/60">
                    <Td>
                      <Check
                        checked={selected.has(item.documentId)}
                        onChange={() => toggle(item.documentId)}
                        aria-label={item.number ?? ''}
                      />
                    </Td>
                    <Td>
                      <Link
                        href={`/documents/${item.documentId}`}
                        className="font-medium text-brand hover:underline"
                      >
                        {item.number ?? '—'}
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`/contacts/${item.contactId}`} className="hover:text-brand">
                        {item.contactName}
                      </Link>
                      {!item.contactEmail && (
                        <div className="text-xs text-danger">{t('Pas d’email')}</div>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-muted">{date(item.dueDate)}</Td>
                    <Td>
                      <Badge tone={BUCKET_TONE[item.bucket] ?? 'neutral'}>
                        {t('{n} j', { n: item.daysOverdue })}
                      </Badge>
                    </Td>
                    <Td numeric className="font-semibold">
                      {money(item.outstanding, item.currency)}
                    </Td>
                    <Td className="text-xs text-ink-muted">
                      {item.reminderCount > 0
                        ? `${item.reminderCount} · ${dateTime(item.lastRemindedAt)}`
                        : '—'}
                    </Td>
                    <Td>
                      <Button
                        size="sm"
                        disabled={remind.isPending || !item.contactEmail}
                        onClick={() => remind.mutate({ documentIds: [item.documentId], force: false })}
                      >
                        <Icon name="mail" />
                        {t('Relancer')}
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {ageing.isPending ? (
            <TableSkeleton rows={6} cols={7} />
          ) : ageing.data && ageing.data.rows.length > 0 ? (
            <Table className="min-w-[860px]">
              <thead>
                <tr>
                  <Th>{t('Client')}</Th>
                  {Object.keys(BUCKET_LABELS).map((key) => (
                    <Th key={key} numeric>
                      {t(BUCKET_LABELS[key]!)}
                    </Th>
                  ))}
                  <Th numeric>{t('Total')}</Th>
                </tr>
              </thead>
              <tbody>
                {ageing.data.rows.map((row) => (
                  <tr key={row.contactId} className="hover:bg-surface-muted/60">
                    <Td>
                      <Link
                        href={`/receivables?contactId=${row.contactId}`}
                        className="font-medium hover:text-brand"
                      >
                        {row.contactName}
                      </Link>
                      <span className="ms-2 text-xs text-ink-subtle">{row.invoiceCount}</span>
                    </Td>
                    {(['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const).map((key) => (
                      <Td key={key} numeric className="text-ink-muted">
                        {Number(row.buckets[key]) > 0 ? money(row.buckets[key], ageing.data.currency) : '—'}
                      </Td>
                    ))}
                    <Td numeric className="font-semibold">
                      {money(row.buckets.total, ageing.data.currency)}
                    </Td>
                  </tr>
                ))}
                <tr className="bg-surface-muted/60 font-semibold">
                  <Td>{t('Total')}</Td>
                  {(['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const).map((key) => (
                    <Td key={key} numeric>
                      {money(ageing.data.totals[key], ageing.data.currency)}
                    </Td>
                  ))}
                  <Td numeric>{money(ageing.data.totals.total, ageing.data.currency)}</Td>
                </tr>
              </tbody>
            </Table>
          ) : (
            <EmptyState icon="wallet" title={t('Aucune créance ouverte')} />
          )}
        </Card>
      )}

      {forceIds && (
        <Dialog
          open
          onClose={() => setForceIds(null)}
          title={t('Relancer à nouveau ?')}
          description={t('{n} facture(s) ont été relancées il y a moins de 24 h.', { n: forceIds.length })}
          width="sm"
          footer={
            <>
              <Button onClick={() => setForceIds(null)}>{t('Annuler')}</Button>
              <Button
                variant="primary"
                loading={remind.isPending}
                onClick={() => remind.mutate({ documentIds: forceIds, force: true })}
              >
                {t('Relancer quand même')}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-muted">
            {t('Envoyer une nouvelle relance si rapprochée peut agacer le client.')}
          </p>
        </Dialog>
      )}
    </>
  );
}
