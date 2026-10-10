'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { usePaymentMethods } from '@/lib/use-payment-methods';
import { Button, Dialog, ErrorNote, Field, Input, NumberInput, toast } from '../ui';
import {
  EMPTY_METHOD_FIELDS,
  PaymentMethodFields,
  methodFieldsMissing,
  type MethodFieldsValue,
} from '../payment-method-fields';

/**
 * One payment to a supplier spread over their purchase invoices, oldest due
 * first. The API does the split when no per-invoice amount is given.
 */
export function SupplierPaymentDialog({
  contactId,
  contactName,
  documents,
  currency,
  onClose,
}: {
  contactId: string;
  contactName: string;
  /** Open purchase invoices of this supplier, soonest due first. */
  documents: Array<{ id: string; outstanding: string }>;
  currency: string;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const methods = usePaymentMethods();
  const owed = documents.reduce((sum, document) => sum + Number(document.outstanding), 0);
  const [amount, setAmount] = useState(owed.toFixed(2));
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [fields, setFields] = useState<MethodFieldsValue>(EMPTY_METHOD_FIELDS);
  const [error, setError] = useState<string | null>(null);

  const pay = useMutation({
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
            amount,
            paidAt,
            allocations: documents.map((document) => ({ documentId: document.id })),
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success(t('Règlement enregistré'));
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  const over = Number(amount) > owed + 0.005;

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Payer le fournisseur')}
      description={contactName}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant="primary"
            loading={pay.isPending}
            disabled={Number(amount) <= 0 || over || methodFieldsMissing(methods.data, fields)}
            onClick={() => pay.mutate()}
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
          <span className="tabular text-lg font-semibold text-ink">{money(owed.toFixed(2), currency)}</span>
        </div>
        <Field
          label={t('Montant')}
          required
          hint={t('Réparti sur les factures, de la plus ancienne échéance à la plus récente')}
          error={over ? t('Supérieur au reste dû') : undefined}
        >
          <NumberInput value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus />
        </Field>
        <Field label={t('Date du règlement')}>
          <Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
        </Field>
        <PaymentMethodFields value={fields} onChange={setFields} />
      </div>
    </Dialog>
  );
}
