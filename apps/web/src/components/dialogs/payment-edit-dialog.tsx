'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { documentSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { api, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { money } from '@/lib/format';
import { usePaymentMethods } from '@/lib/use-payment-methods';
import { Button, Dialog, ErrorNote, Field, Input, NumberInput, toast } from '../ui';
import { PaymentMethodFields, methodFieldsMissing, type MethodFieldsValue } from '../payment-method-fields';

type Payment = z.infer<typeof documentSchemas.payment>;

/** Everything a payment change can affect: invoices, balances, reports, the till. */
function useRefreshAfterChange() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries();
}

/** Correct a recorded payment: amount, method, dates, reference and the split across documents. */
export function EditPaymentDialog({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const t = useT();
  const refresh = useRefreshAfterChange();
  const split = payment.allocations.length > 1;

  const [amount, setAmount] = useState(payment.amount);
  const [parts, setParts] = useState(
    Object.fromEntries(payment.allocations.map((a) => [a.documentId, a.amount])),
  );
  const methods = usePaymentMethods();
  const [fields, setFields] = useState<MethodFieldsValue>({
    // Payments recorded before methods were configurable resolve by kind below.
    methodId: payment.methodId ?? '',
    reference: payment.reference ?? '',
    bankName: payment.bankName ?? '',
    dueDate: payment.dueDate ?? '',
  });
  useEffect(() => {
    if (fields.methodId || !methods.data) return;
    const match = methods.data.find((entry) => entry.kind === payment.method);
    if (match) setFields((current) => ({ ...current, methodId: match.id }));
  }, [fields.methodId, methods.data, payment.method]);
  const [paidAt, setPaidAt] = useState(payment.paidAt);
  const [note, setNote] = useState(payment.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const total = split
    ? payment.allocations.reduce((sum, a) => sum + Number(parts[a.documentId] || 0), 0)
    : Number(amount);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await api.payments.update({
          params: { id: payment.id },
          body: {
            methodId: fields.methodId || undefined,
            bankName: fields.bankName || null,
            dueDate: fields.dueDate || null,
            reference: fields.reference || null,
            paidAt,
            note: note || null,
            amount: split ? total.toFixed(2) : amount,
            allocations: payment.allocations.map((a) => ({
              documentId: a.documentId,
              amount: split ? parts[a.documentId] || '0' : amount,
            })),
          },
        }),
      );
    },
    onSuccess: () => {
      refresh();
      toast.success(t('Paiement modifié'));
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Modifier le paiement')}
      description={`${payment.contactName} — ${money(payment.amount, payment.currency)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!(total > 0) || methodFieldsMissing(methods.data, fields)}
            onClick={() => save.mutate()}
          >
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>

        {split ? (
          <div className="space-y-2">
            {payment.allocations.map((allocation) => (
              <Field key={allocation.documentId} label={allocation.documentNumber ?? '—'}>
                <NumberInput
                  value={parts[allocation.documentId] ?? ''}
                  onChange={(event) =>
                    setParts({ ...parts, [allocation.documentId]: event.target.value })
                  }
                />
              </Field>
            ))}
            <p className="text-sm text-ink-muted">
              {t('Montant')} : <strong>{money(total.toFixed(2), payment.currency)}</strong>
            </p>
          </div>
        ) : (
          <Field label={t('Montant')} required>
            <NumberInput value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
        )}

        <Field label={t('Date du règlement')}>
          <Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
        </Field>

        <PaymentMethodFields value={fields} onChange={setFields} />

        <Field label={t('Note')}>
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Cancel a payment; the documents it settled become payable again. */
export function CancelPaymentDialog({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const t = useT();
  const refresh = useRefreshAfterChange();

  const cancel = useMutation({
    mutationFn: async () => unwrap(await api.payments.remove({ params: { id: payment.id } })),
    onSuccess: () => {
      refresh();
      toast.success(t('Paiement annulé'));
      onClose();
    },
    onError: (cause) => {
      onClose();
      toast.error(cause instanceof ApiError ? cause.message : t('Suppression impossible'));
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Annuler ce paiement ?')}
      description={t(
        'Le paiement de {amount} de {name} sera annulé et les documents concernés redeviendront impayés.',
        { amount: money(payment.amount, payment.currency), name: payment.contactName },
      )}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Retour')}
          </Button>
          <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            {t('Annuler le paiement')}
          </Button>
        </>
      }
    >
      <></>
    </Dialog>
  );
}
