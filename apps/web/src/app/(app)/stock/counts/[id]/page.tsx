'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import { COUNT_STATUS, StockTabs } from '@/components/stock-tabs';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  ErrorNote,
  Field,
  Input,
  NumberInput,
  PageHeader,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { dateTime, qty } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

export default function CountDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  // Quantities typed but not yet saved, keyed by variant.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [postNote, setPostNote] = useState('');

  const session = useQuery({
    queryKey: ['count-session', id],
    queryFn: async () => unwrap(await api.inventory.getCountSession({ params: { id } })),
  });

  const data = session.data;
  const closed = data?.status === 'POSTED' || data?.status === 'ABANDONED';
  const pending = Object.entries(draft).filter(([, value]) => value.trim() !== '');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['count-session', id] });
    void queryClient.invalidateQueries({ queryKey: ['count-sessions'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await api.inventory.submitCount({
          params: { id },
          body: {
            lines: pending.map(([variantId, countedQuantity]) => ({ variantId, countedQuantity })),
          },
        }),
      );
    },
    onSuccess: () => {
      setDraft({});
      refresh();
      toast.success(t('Comptage enregistré'));
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  const post = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.inventory.postCount({
          params: { id },
          body: { note: postNote.trim() || undefined },
        }),
      ),
    onSuccess: () => {
      setPostOpen(false);
      void queryClient.invalidateQueries();
      toast.success(t('Inventaire validé, stock corrigé'));
    },
    onError: (cause) => {
      setPostOpen(false);
      setError(cause instanceof ApiError ? cause.message : t('Validation impossible'));
    },
  });

  if (session.isPending) {
    return (
      <>
        <StockTabs />
        <TableSkeleton rows={6} cols={5} />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <StockTabs />
        <ErrorNote>{t('Inventaire introuvable')}</ErrorNote>
      </>
    );
  }

  const status = COUNT_STATUS[data.status] ?? { tone: 'neutral' as const, label: data.status };
  const countedLines = data.lines.filter((line) => line.countedQuantity !== null).length;
  // A blind session reveals expected quantities (and so variances) only once
  // the counter has submitted.
  const showExpected = data.lines.some((line) => line.expectedQuantity !== null);

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {data.reference}
            <Badge tone={status.tone}>{t(status.label)}</Badge>
          </span>
        }
        subtitle={`${data.warehouseName} · ${dateTime(data.startedAt)}${data.isBlind ? ` · ${t('À l’aveugle')}` : ''}`}
        actions={
          <>
            <Link href="/stock/counts" className="text-sm text-ink-muted hover:text-ink">
              {t('Tous les inventaires')}
            </Link>
            {!closed && (
              <>
                <Button
                  loading={save.isPending}
                  disabled={pending.length === 0}
                  onClick={() => save.mutate()}
                >
                  {t('Enregistrer le comptage')}
                </Button>
                <Button
                  variant="primary"
                  disabled={countedLines === 0 || pending.length > 0}
                  onClick={() => setPostOpen(true)}
                >
                  <Icon name="check" /> {t('Valider l’inventaire')}
                </Button>
              </>
            )}
          </>
        }
      />
      <StockTabs />
      <div className="mb-4">
        <ErrorNote>{error}</ErrorNote>
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title={t('Lignes de comptage')}
          description={t('{counted} / {total} lignes comptées · {variances} écart(s)', {
            counted: countedLines,
            total: data.lines.length,
            variances: data.varianceCount,
          })}
        />
        <Table className="min-w-[760px]">
          <thead>
            <tr>
              <Th>{t('Article')}</Th>
              {showExpected && <Th numeric>{t('Théorique')}</Th>}
              <Th numeric className="w-36">
                {t('Compté')}
              </Th>
              {showExpected && <Th numeric>{t('Écart')}</Th>}
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => {
              const variance = line.variance === null ? null : Number(line.variance);
              return (
                <tr key={line.id} className="hover:bg-surface-muted/60">
                  <Td>
                    <span className="font-semibold">{line.productName}</span>
                    <div className="text-xs text-ink-muted">
                      {line.sku}
                      {line.variantLabel ? ` · ${line.variantLabel}` : ''}
                    </div>
                  </Td>
                  {showExpected && (
                    <Td numeric className="text-ink-muted">
                      {line.expectedQuantity === null ? '—' : qty(line.expectedQuantity)}
                    </Td>
                  )}
                  <Td numeric>
                    {closed ? (
                      line.countedQuantity === null ? '—' : qty(line.countedQuantity)
                    ) : (
                      <NumberInput
                        aria-label={t('Quantité comptée')}
                        placeholder={line.countedQuantity === null ? '' : qty(line.countedQuantity)}
                        value={draft[line.variantId] ?? ''}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, [line.variantId]: event.target.value }))
                        }
                      />
                    )}
                  </Td>
                  {showExpected && (
                    <Td
                      numeric
                      className={
                        variance === null || variance === 0
                          ? 'text-ink-subtle'
                          : variance < 0
                            ? 'font-semibold text-danger'
                            : 'font-semibold text-positive'
                      }
                    >
                      {variance === null ? '—' : `${variance > 0 ? '+' : ''}${qty(line.variance)}`}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {postOpen && (
        <Dialog
          open
          onClose={() => setPostOpen(false)}
          title={t('Valider l’inventaire')}
          description={t(
            'Le stock sera corrigé pour correspondre aux quantités comptées. Cette action est définitive.',
          )}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPostOpen(false)}>
                {t('Annuler')}
              </Button>
              <Button variant="primary" loading={post.isPending} onClick={() => post.mutate()}>
                {t('Valider')}
              </Button>
            </>
          }
        >
          <Field label={t('Note')}>
            <Input value={postNote} onChange={(event) => setPostNote(event.target.value)} />
          </Field>
        </Dialog>
      )}
    </>
  );
}
