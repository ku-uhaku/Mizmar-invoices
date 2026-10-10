'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { money } from '@/lib/format';
import { usePaymentMethods } from '@/lib/use-payment-methods';
import { Button, Dialog, ErrorNote, Field, Input, NumberInput, toast } from '../ui';
import {
  EMPTY_METHOD_FIELDS,
  PaymentMethodFields,
  methodFieldsMissing,
  type MethodFieldsValue,
} from '../payment-method-fields';

export function PaymentDialog({
  documentId,
  contactId,
  outstanding,
  currency,
  open,
  onClose,
}: {
  documentId: string;
  contactId: string;
  outstanding: string;
  currency: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Defaults to settling the balance in full, which is the common case.
  const [amountValue, setAmountValue] = useState(outstanding);
  const methods = usePaymentMethods();
  const [fields, setFields] = useState<MethodFieldsValue>(EMPTY_METHOD_FIELDS);
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const record = useMutation({
    mutationFn: async () => {
      setError(null);
      const picked = methods.data?.find((entry) => entry.id === fields.methodId);
      return unwrap(
        await api.payments.create({
          body: {
            contactId,
            method: picked?.kind ?? 'OTHER',
            methodId: fields.methodId || undefined,
            reference: fields.reference || undefined,
            bankName: fields.bankName || undefined,
            dueDate: fields.dueDate || undefined,
            amount: amountValue,
            paidAt,
            note: note || undefined,
            allocations: [{ documentId, amount: amountValue }],
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success(t('Règlement enregistré'));
      onClose();
      router.refresh();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  const over = Number(amountValue) > Number(outstanding);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="sm"
      title={t('Enregistrer un règlement')}
      description={t('Le montant sera imputé sur ce document.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant="primary"
            loading={record.isPending}
            disabled={Number(amountValue) <= 0 || over || methodFieldsMissing(methods.data, fields)}
            onClick={() => record.mutate()}
          >
            {t('Enregistrer le règlement')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>

        <div className="flex items-center justify-between gap-3 rounded-xl bg-brand-soft px-4 py-3">
          <span className="text-sm font-medium text-brand">{t('Reste dû')}</span>
          <span className="tabular text-lg font-semibold text-ink">
            {money(outstanding, currency)}
          </span>
        </div>

        <Field label={t('Montant')} required error={over ? t('Supérieur au reste dû') : undefined}>
          <NumberInput
            value={amountValue}
            onChange={(event) => setAmountValue(event.target.value)}
            autoFocus
          />
        </Field>

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
