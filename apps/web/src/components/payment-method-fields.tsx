'use client';

import { useEffect } from 'react';
import { useT } from '@/lib/i18n/provider';
import { usePaymentMethods, type PaymentMethodOption } from '@/lib/use-payment-methods';
import { Field, Input, Select } from './ui';

export interface MethodFieldsValue {
  methodId: string;
  reference: string;
  bankName: string;
  dueDate: string;
}

export const EMPTY_METHOD_FIELDS: MethodFieldsValue = {
  methodId: '',
  reference: '',
  bankName: '',
  dueDate: '',
};

/** Whether the picked method still needs a reference before saving. */
export function methodFieldsMissing(
  methods: PaymentMethodOption[] | undefined,
  value: MethodFieldsValue,
): boolean {
  const picked = methods?.find((method) => method.id === value.methodId);
  return Boolean(picked?.requiresReference && !value.reference.trim());
}

/**
 * Method picker driven by the organization's table. Deferred methods (cheque,
 * bill of exchange) also ask for the bank and the due date they can be cashed.
 */
export function PaymentMethodFields({
  value,
  onChange,
}: {
  value: MethodFieldsValue;
  onChange: (next: MethodFieldsValue) => void;
}) {
  const t = useT();
  const methods = usePaymentMethods();
  const active = (methods.data ?? []).filter((method) => method.isActive || method.id === value.methodId);
  const picked = active.find((method) => method.id === value.methodId);

  // Land on the bank transfer (or the first method) once the table has loaded.
  useEffect(() => {
    if (value.methodId || active.length === 0) return;
    const first = active.find((method) => method.kind === 'BANK_TRANSFER') ?? active[0]!;
    onChange({ ...value, methodId: first.id });
  }, [active, value, onChange]);

  const set = (patch: Partial<MethodFieldsValue>) => onChange({ ...value, ...patch });

  return (
    <>
      <Field label={t('Moyen de paiement')} required>
        <Select value={value.methodId} onChange={(event) => set({ methodId: event.target.value })}>
          {active.map((method) => (
            <option key={method.id} value={method.id}>
              {t(method.name)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={t('Référence')}
        required={picked?.requiresReference}
        hint={picked?.deferred ? t('N° du chèque ou de l’effet') : t('N° de virement, de transaction…')}
      >
        <Input value={value.reference} onChange={(event) => set({ reference: event.target.value })} />
      </Field>

      {picked?.deferred && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Banque')}>
            <Input value={value.bankName} onChange={(event) => set({ bankName: event.target.value })} />
          </Field>
          <Field label={t('Date d’échéance')} hint={t('Date à partir de laquelle il peut être encaissé')}>
            <Input type="date" value={value.dueDate} onChange={(event) => set({ dueDate: event.target.value })} />
          </Field>
        </div>
      )}
    </>
  );
}
