'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { amount, money } from '@/lib/format';
import { Icon } from '../icons';
import { Button, Dialog, ErrorNote, Skeleton, Table, Td, Th, toast } from '../ui';

/**
 * The confirmation step before anything is written.
 *
 * It states the exact ledger rows and the number about to be issued, because
 * validation is irreversible: it burns a document number and moves stock, and
 * "are you sure?" without the specifics is not a question anyone can answer.
 */
export function ValidateDialog({
  documentId,
  open,
  onClose,
}: {
  documentId: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['validate-preview', documentId],
    queryFn: async () =>
      unwrap(await api.documents.validationPreview({ params: { id: documentId }, body: {} })),
    enabled: open,
    staleTime: 0,
  });

  const validate = useMutation({
    mutationFn: async (confirmNegativeStock: boolean) => {
      setError(null);
      return unwrap(
        await api.documents.validate({
          params: { id: documentId },
          body: { confirmNegativeStock },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success(t('Document validé'));
      onClose();
      router.refresh();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Validation impossible')),
  });

  const data = preview.data;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title={t('Valider le document')}
      description={t('Cette action attribue un numéro définitif et écrit les mouvements de stock.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant={data?.requiresConfirmation ? 'danger' : 'primary'}
            disabled={!data || data.blocked}
            loading={validate.isPending}
            onClick={() => validate.mutate(Boolean(data?.requiresConfirmation))}
          >
            {data?.requiresConfirmation
              ? t('Valider malgré le stock négatif')
              : t('Valider le document')}
          </Button>
        </>
      }
    >
      {preview.isPending ? (
        <div className="space-y-3" role="status" aria-label={t('Analyse en cours')}>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !data ? (
        <ErrorNote>{t('Impossible de préparer la validation.')}</ErrorNote>
      ) : (
        <div className="space-y-4">
          <ErrorNote>{error}</ErrorNote>

          {data.willAllocateNumber && (
            <div className="flex items-center gap-3 rounded-xl bg-brand-soft px-4 py-3">
              <Icon name="file" className="size-5 text-brand" />
              <div className="text-sm">
                <p className="text-ink-muted">{t('Numéro définitif attribué')}</p>
                <p className="font-semibold text-ink">{data.nextNumberPreview}</p>
              </div>
            </div>
          )}

          {data.shortfalls.length > 0 && (
            <div
              className={
                data.blocked
                  ? 'rounded-lg border border-danger/30 bg-danger-soft p-3'
                  : 'rounded-lg border border-warning/30 bg-warning-soft p-3'
              }
            >
              <p
                className={
                  data.blocked
                    ? 'flex items-center gap-1.5 text-sm font-medium text-danger'
                    : 'flex items-center gap-1.5 text-sm font-medium text-warning'
                }
              >
                <Icon name="alert" />
                {data.blocked
                  ? t('Stock insuffisant — la validation est bloquée')
                  : t('Stock insuffisant — confirmation requise')}
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {data.shortfalls.map((shortfall) => (
                  <li key={`${shortfall.variantId}-${shortfall.warehouseId}`} className="text-ink">
                    {t('{sku} — {product} @ {warehouse} : demandé {requested}, disponible {available} (manque {short})', {
                      sku: shortfall.sku,
                      product: shortfall.productName,
                      warehouse: shortfall.warehouseCode,
                      requested: amount(shortfall.requested),
                      available: amount(shortfall.available),
                      short: amount(shortfall.shortBy),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              {t('Mouvements de stock')} ({data.movements.length})
            </h3>
            {data.movements.length === 0 ? (
              <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-ink-muted">
                {t('Aucun mouvement : la marchandise a déjà été sortie par les documents amont.')}
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <Table>
                  <thead>
                    <tr>
                      <Th>{t('Article')}</Th>
                      <Th>{t('Dépôt')}</Th>
                      <Th numeric>{t('Quantité')}</Th>
                      <Th numeric>{t('Avant')}</Th>
                      <Th numeric>{t('Après')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.movements.map((movement, index) => (
                      <tr key={`${movement.variantId}-${index}`}>
                        <Td>
                          <span className="font-medium">{movement.sku}</span>
                          <span className="text-ink-muted"> — {movement.productName}</span>
                        </Td>
                        <Td>{movement.warehouseCode}</Td>
                        <Td
                          numeric
                          className={movement.direction === 'OUT' ? 'text-danger' : 'text-positive'}
                        >
                          {movement.direction === 'OUT' ? '−' : '+'}
                          {amount(movement.quantity)}
                        </Td>
                        <Td numeric className="text-ink-muted">
                          {amount(movement.onHandBefore)}
                        </Td>
                        <Td numeric className="font-medium">
                          {amount(movement.onHandAfter)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </section>

          {data.reservations.length > 0 && (
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                {t('Réservations')}
              </h3>
              <ul className="space-y-1 text-sm text-ink-muted">
                {data.reservations.map((reservation, index) => (
                  <li key={index}>
                    {reservation.action === 'HOLD' ? t('Réserve') : t('Libère')}{' '}
                    {amount(reservation.quantity)} × {reservation.sku}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-muted">{t('Total HT')}</span>
              <span className="tabular">{money(data.totals.totalExclVat)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>{t('Total TTC')}</span>
              <span className="tabular">{money(data.totals.totalInclVat)}</span>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
