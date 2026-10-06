'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { DocumentType } from '@mizmar/core';
import { api, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { amount, documentTypeLabel, money } from '@/lib/format';
import {
  Button,
  Checkbox,
  Dialog,
  ErrorNote,
  NumberInput,
  Skeleton,
  Table,
  Td,
  Th,
  toast,
} from '../ui';

/**
 * The one-click conversion dialog.
 *
 * Shows ordered / already drawn / remaining per line, with the quantity
 * defaulted to the remainder. Converting the same order twice therefore picks
 * up exactly where the last one stopped, and over-delivery is impossible.
 */
export function ConvertDialog({
  documentId,
  targetType,
  open,
  onClose,
}: {
  documentId: string;
  targetType: DocumentType | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [validateImmediately, setValidateImmediately] = useState(false);
  const [returnToStock, setReturnToStock] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useQuery({
    queryKey: ['conversion-options', documentId, targetType],
    queryFn: async () =>
      unwrap(
        await api.documents.conversionOptions({
          params: { id: documentId },
          query: { targetType: targetType! },
        }),
      ),
    enabled: open && Boolean(targetType),
    staleTime: 0,
  });

  // Default every line to its full remainder, which is what the user wants in
  // the overwhelming majority of conversions.
  useEffect(() => {
    if (!options.data) return;
    setQuantities(
      Object.fromEntries(options.data.lines.map((line) => [line.sourceLineId, line.remaining])),
    );
  }, [options.data]);

  const convert = useMutation({
    mutationFn: async () => {
      setError(null);
      const selections = (options.data?.lines ?? [])
        .map((line) => ({
          sourceDocumentId: line.sourceDocumentId,
          sourceLineId: line.sourceLineId,
          quantity: quantities[line.sourceLineId] ?? '0',
        }))
        .filter((selection) => Number(selection.quantity) > 0);

      return unwrap(
        await api.documents.convert({
          body: {
            sourceDocumentIds: [documentId],
            targetType: targetType!,
            selections,
            validateImmediately,
            ...(targetType === 'CREDIT_NOTE' ? { returnToStock } : {}),
          },
        }),
      );
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries();
      toast.success(t('{type} créé', { type: documentTypeLabel(targetType!) }));
      onClose();
      router.push(`/documents/${created.id}`);
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Conversion impossible')),
  });

  if (!targetType) return null;

  const totalSelected = (options.data?.lines ?? []).reduce(
    (sum, line) => sum + Number(quantities[line.sourceLineId] ?? 0),
    0,
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title={t('Convertir en {type}', { type: documentTypeLabel(targetType).toLowerCase() })}
      description={t('Ajustez les quantités pour une livraison ou une facturation partielle.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant="primary"
            disabled={totalSelected <= 0}
            loading={convert.isPending}
            onClick={() => convert.mutate()}
          >
            {t('Créer le {type}', { type: documentTypeLabel(targetType).toLowerCase() })}
          </Button>
        </>
      }
    >
      {options.isPending ? (
        <div className="space-y-3" role="status" aria-label={t('Chargement')}>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : options.error ? (
        <ErrorNote>
          {options.error instanceof ApiError ? options.error.message : t('Conversion impossible')}
        </ErrorNote>
      ) : (
        <div className="space-y-4">
          <ErrorNote>{error}</ErrorNote>

          <div className="overflow-hidden rounded-xl border border-border">
            <Table>
              <thead>
                <tr>
                  <Th>{t('Article')}</Th>
                  <Th numeric>{t('Commandé')}</Th>
                  <Th numeric>{t('Déjà traité')}</Th>
                  <Th numeric>{t('Restant')}</Th>
                  <Th numeric className="w-28">
                    {t('À reprendre')}
                  </Th>
                </tr>
              </thead>
              <tbody>
                {options.data?.lines.map((line) => {
                  const remaining = Number(line.remaining);
                  const picked = Number(quantities[line.sourceLineId] ?? 0);
                  const invalid = picked > remaining;

                  return (
                    <tr
                      key={line.sourceLineId}
                      className={remaining <= 0 ? 'opacity-50' : undefined}
                    >
                      <Td>
                        <div className="font-medium">{line.description}</div>
                        <div className="text-xs text-ink-subtle">
                          {line.sku}
                          {line.variantLabel ? ` · ${line.variantLabel}` : ''}
                          {' · '}
                          {money(line.unitPrice)}
                        </div>
                      </Td>
                      <Td numeric className="text-ink-muted">
                        {amount(line.ordered)}
                      </Td>
                      <Td numeric className="text-ink-muted">
                        {amount(line.alreadyDrawn)}
                      </Td>
                      <Td numeric className="font-medium">
                        {amount(line.remaining)}
                      </Td>
                      <Td numeric>
                        <NumberInput
                          value={quantities[line.sourceLineId] ?? ''}
                          disabled={remaining <= 0}
                          onChange={(event) =>
                            setQuantities((current) => ({
                              ...current,
                              [line.sourceLineId]: event.target.value,
                            }))
                          }
                          className={invalid ? 'border-danger' : undefined}
                        />
                        {invalid && (
                          <p className="mt-1 text-[11px] text-danger">{t('Au-delà du restant')}</p>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-brand-soft px-4 py-3 text-sm">
            <span className="font-medium text-brand">{t('Quantité totale à reprendre')}</span>
            <span className="tabular font-semibold text-ink">{amount(String(totalSelected))}</span>
          </div>

          <div className="space-y-2 rounded-xl border border-border bg-surface-muted/50 p-3">
            {targetType === 'CREDIT_NOTE' && (
              <Checkbox
                label={t('Les articles sont retournés en stock')}
                checked={returnToStock}
                onChange={(event) => setReturnToStock(event.target.checked)}
              />
            )}
            <Checkbox
              label={t('Valider immédiatement le document créé')}
              checked={validateImmediately}
              onChange={(event) => setValidateImmediately(event.target.checked)}
            />
          </div>
        </div>
      )}
    </Dialog>
  );
}
