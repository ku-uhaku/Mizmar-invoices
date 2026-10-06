'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { money, paymentMethodLabel } from '@/lib/format';
import { Button, Dialog, ErrorNote, Field, Input, NumberInput, Select, toast } from '../ui';

// Labels come from paymentMethodLabel so they follow the UI language.
const METHODS = [
  ['BANK_TRANSFER'],
  ['CHEQUE'],
  ['CASH'],
  ['BILL_OF_EXCHANGE'],
  ['CARD'],
  ['OTHER'],
] as const;

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
  const [method, setMethod] = useState<(typeof METHODS)[number][0]>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const record = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await api.payments.create({
          body: {
            contactId,
            method,
            reference: reference || undefined,
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
            disabled={Number(amountValue) <= 0 || over}
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

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Moyen de paiement')}>
            <Select
              value={method}
              onChange={(event) => setMethod(event.target.value as typeof method)}
            >
              {METHODS.map(([value]) => (
                <option key={value} value={value}>
                  {paymentMethodLabel(value)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('Date du règlement')}>
            <Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
          </Field>
        </div>

        <Field label={t('Référence')} hint={t('N° de chèque, de virement…')}>
          <Input value={reference} onChange={(event) => setReference(event.target.value)} />
        </Field>

        <Field label={t('Note')}>
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
