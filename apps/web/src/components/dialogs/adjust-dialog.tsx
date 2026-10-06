'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { VariantSearchResult } from '@mizmar/contracts';
import { api, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { ADJUSTMENT_REASON_LABELS, adjustmentReasonLabel } from '@/lib/format';
import { Icon } from '../icons';
import {
  Button,
  Dialog,
  ErrorNote,
  Field,
  IconButton,
  Input,
  NumberInput,
  Select,
  Table,
  Td,
  Th,
  toast,
} from '../ui';
import { VariantPicker } from '../variant-picker';

interface AdjustLine {
  key: string;
  variantId: string;
  label: string;
  sku: string;
  delta: string;
}

/**
 * Manual stock adjustment.
 *
 * Captures a signed *delta*, not a target quantity: a target computed from a
 * screen opened five minutes ago would silently erase every sale made since.
 */
export function AdjustDialog({
  open,
  onClose,
  defaultWarehouseId,
}: {
  open: boolean;
  onClose: () => void;
  defaultWarehouseId?: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId ?? '');
  const [reason, setReason] = useState<keyof typeof ADJUSTMENT_REASON_LABELS>('DAMAGED');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<AdjustLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => unwrap(await api.inventory.listWarehouses()),
  });

  const effectiveWarehouse = warehouseId || warehouses.data?.[0]?.id || '';

  function add(variant: VariantSearchResult) {
    setLines((current) =>
      current.some((line) => line.variantId === variant.variantId)
        ? current
        : [
            ...current,
            {
              key: crypto.randomUUID(),
              variantId: variant.variantId,
              label: `${variant.productName}${variant.variantLabel ? ` — ${variant.variantLabel}` : ''}`,
              sku: variant.sku,
              delta: '-1',
            },
          ],
    );
  }

  const submit = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await api.inventory.adjust({
          body: {
            warehouseId: effectiveWarehouse,
            reason: reason as 'DAMAGED',
            note: note || undefined,
            lines: lines
              .filter((line) => Number(line.delta) !== 0)
              .map((line) => ({ variantId: line.variantId, quantityDelta: line.delta })),
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success(t('Stock ajusté'));
      setLines([]);
      setNote('');
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Ajustement impossible')),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title={t('Ajuster le stock')}
      description={t('Saisissez un écart signé : négatif pour une sortie, positif pour une entrée.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant="primary"
            loading={submit.isPending}
            disabled={lines.length === 0 || !effectiveWarehouse}
            onClick={() => submit.mutate()}
          >
            {t('Enregistrer l’ajustement')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNote>{error}</ErrorNote>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Dépôt')} required>
            <Select value={effectiveWarehouse} onChange={(event) => setWarehouseId(event.target.value)}>
              {warehouses.data?.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} — {warehouse.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('Motif')} required>
            <Select
              value={reason}
              onChange={(event) => setReason(event.target.value as typeof reason)}
            >
              {Object.keys(ADJUSTMENT_REASON_LABELS).map((value) => (
                <option key={value} value={value}>
                  {adjustmentReasonLabel(value)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={t('Articles')}>
          <VariantPicker warehouseId={effectiveWarehouse} onPick={add} />
        </Field>

        {lines.length === 0 && (
          <p className="rounded-lg border border-dashed border-border-strong px-4 py-5 text-center text-sm text-ink-muted">
            {t('Recherchez un article ci-dessus pour l’ajouter à l’ajustement.')}
          </p>
        )}

        {lines.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <thead>
              <tr>
                <Th>{t('Article')}</Th>
                <Th numeric className="w-32">
                  {t('Écart')}
                </Th>
                <Th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key}>
                  <Td>
                    <div className="font-medium">{line.label}</div>
                    <div className="text-xs text-ink-subtle">{line.sku}</div>
                  </Td>
                  <Td numeric>
                    <NumberInput
                      value={line.delta}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((l) =>
                            l.key === line.key ? { ...l, delta: event.target.value } : l,
                          ),
                        )
                      }
                    />
                  </Td>
                  <Td>
                    <IconButton
                      label={t('Retirer')}
                      onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))}
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
      </div>
    </Dialog>
  );
}
