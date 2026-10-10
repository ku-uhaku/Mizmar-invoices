'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { VariantSearchResult } from '@mizmar/contracts';
import { api, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import { VariantPicker } from '@/components/variant-picker';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNote,
  Field,
  IconButton,
  Input,
  NumberInput,
  PageHeader,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { dateTime, MOVEMENT_TYPE_LABELS, qty } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

interface TransferLine {
  variantId: string;
  label: string;
  sku: string;
  available: string;
  quantity: string;
}

export default function TransfersPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => unwrap(await api.inventory.listWarehouses()),
  });
  const active = warehouses.data?.filter((warehouse) => warehouse.isActive) ?? [];

  const history = useQuery({
    queryKey: ['movements', 'transfers'],
    queryFn: async () => {
      const [out, inbound] = await Promise.all([
        api.inventory.movements({ query: { limit: 30, type: 'TRANSFER_OUT' } }),
        api.inventory.movements({ query: { limit: 30, type: 'TRANSFER_IN' } }),
      ]);
      return [...unwrap(out).items, ...unwrap(inbound).items].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    },
  });

  const source = sourceId || active[0]?.id || '';
  const destination = destinationId || active.find((warehouse) => warehouse.id !== source)?.id || '';

  function add(variant: VariantSearchResult) {
    setLines((current) =>
      current.some((line) => line.variantId === variant.variantId)
        ? current
        : [
            ...current,
            {
              variantId: variant.variantId,
              label: `${variant.productName}${variant.variantLabel ? ` — ${variant.variantLabel}` : ''}`,
              sku: variant.sku,
              available: variant.available,
              quantity: '1',
            },
          ],
    );
  }

  const submit = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await api.inventory.transfer({
          body: {
            sourceWarehouseId: source,
            destinationWarehouseId: destination,
            note: note.trim() || undefined,
            lines: lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success(t('Transfert enregistré'));
      setLines([]);
      setNote('');
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Transfert impossible')),
  });

  const sameWarehouse = Boolean(source) && source === destination;
  const invalid =
    lines.length === 0 ||
    !source ||
    !destination ||
    sameWarehouse ||
    lines.some((line) => !(Number(line.quantity) > 0));

  return (
    <>
      <PageHeader title={t('Stock')} subtitle={t('Transferts entre entrepôts')} />

      <Card className="mb-6">
        <CardHeader
          title={t('Nouveau transfert')}
          description={t('Le stock sort de l’entrepôt source et entre immédiatement dans la destination.')}
        />
        <div className="space-y-4 p-5">
          <ErrorNote>{error}</ErrorNote>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Entrepôt source')} required>
              <Select value={source} onChange={(event) => setSourceId(event.target.value)}>
                {active.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} — {warehouse.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('Entrepôt destination')}
              required
              error={sameWarehouse ? t('Choisissez deux entrepôts différents') : undefined}
            >
              <Select value={destination} onChange={(event) => setDestinationId(event.target.value)}>
                {active.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} — {warehouse.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label={t('Articles')}>
            <VariantPicker warehouseId={source} onPick={add} />
          </Field>

          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-strong px-4 py-5 text-center text-sm text-ink-muted">
              {t('Recherchez un article ci-dessus pour l’ajouter au transfert.')}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <thead>
                  <tr>
                    <Th>{t('Article')}</Th>
                    <Th numeric>{t('Disponible')}</Th>
                    <Th numeric className="w-32">
                      {t('Quantité')}
                    </Th>
                    <Th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.variantId}>
                      <Td>
                        <div className="font-medium">{line.label}</div>
                        <div className="text-xs text-ink-subtle">{line.sku}</div>
                      </Td>
                      <Td numeric className="text-ink-muted">
                        {qty(line.available)}
                      </Td>
                      <Td numeric>
                        <NumberInput
                          value={line.quantity}
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((l) =>
                                l.variantId === line.variantId
                                  ? { ...l, quantity: event.target.value }
                                  : l,
                              ),
                            )
                          }
                        />
                        {Number(line.quantity) > Number(line.available) && (
                          <p className="mt-1 text-xs text-danger">{t('Dépasse le disponible')}</p>
                        )}
                      </Td>
                      <Td>
                        <IconButton
                          label={t('Retirer')}
                          onClick={() =>
                            setLines((c) => c.filter((l) => l.variantId !== line.variantId))
                          }
                          className="hover:bg-danger-soft hover:text-danger"
                        >
                          <Icon name="x" />
                        </IconButton>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}

          <Field label={t('Note')}>
            <Input value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>

          <div className="flex justify-end">
            <Button
              variant="primary"
              loading={submit.isPending}
              disabled={invalid}
              onClick={() => submit.mutate()}
            >
              {t('Effectuer le transfert')}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title={t('Transferts récents')}
          description={t('Chaque transfert produit une sortie et une entrée')}
        />
        {history.isPending ? (
          <TableSkeleton rows={5} cols={6} />
        ) : history.data && history.data.length > 0 ? (
          <Table className="min-w-[760px]">
            <thead>
              <tr>
                <Th>{t('Date')}</Th>
                <Th>{t('Article')}</Th>
                <Th>{t('Dépôt')}</Th>
                <Th>{t('Type')}</Th>
                <Th numeric>{t('Quantité')}</Th>
                <Th>{t('Référence')}</Th>
                <Th>{t('Utilisateur')}</Th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((row) => (
                <tr key={row.id} className="hover:bg-surface-muted/60">
                  <Td className="whitespace-nowrap text-ink-muted">{dateTime(row.createdAt)}</Td>
                  <Td>
                    <span className="font-semibold">{row.sku}</span>
                    <div className="text-xs text-ink-muted">
                      {row.productName}
                      {row.variantLabel ? ` · ${row.variantLabel}` : ''}
                    </div>
                  </Td>
                  <Td className="text-ink-muted">{row.warehouseCode}</Td>
                  <Td>
                    <Badge tone={row.direction === 'IN' ? 'success' : 'neutral'}>
                      {t(MOVEMENT_TYPE_LABELS[row.type] ?? row.type)}
                    </Badge>
                  </Td>
                  <Td
                    numeric
                    className={row.direction === 'OUT' ? 'font-medium text-danger' : 'font-medium text-positive'}
                  >
                    {row.direction === 'OUT' ? '−' : '+'}
                    {qty(row.quantity).replace(/^[-−]/, '')}
                  </Td>
                  <Td className="text-ink-muted">{row.note ?? '—'}</Td>
                  <Td className="text-ink-muted">{row.userName ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon="truck"
            title={t('Aucun transfert pour l’instant')}
            description={t('Les transferts entre entrepôts seront listés ici.')}
          />
        )}
      </Card>
    </>
  );
}
