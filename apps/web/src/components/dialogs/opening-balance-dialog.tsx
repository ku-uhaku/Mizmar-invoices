'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { usePaymentMethods } from '@/lib/use-payment-methods';
import { Button, Dialog, ErrorNote, Field, Input, NumberInput, Segmented, toast } from '../ui';
import {
  EMPTY_METHOD_FIELDS,
  PaymentMethodFields,
  methodFieldsMissing,
  type MethodFieldsValue,
} from '../payment-method-fields';

type Kind = 'CLIENT' | 'SUPPLIER' | 'BOTH';
type Side = 'THEY_OWE' | 'I_OWE';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The amount is stored in the contact's natural direction (a client owing you
 * or you owing a supplier is positive), so the "who owes whom" choice maps to
 * a sign that depends on the kind of contact.
 */
const naturalSide = (kind: Kind): Side => (kind === 'SUPPLIER' ? 'I_OWE' : 'THEY_OWE');

/** A debt that already existed between you and this contact before using the app. */
export function OpeningBalanceDialog({
  contactId,
  contactName,
  kind,
  current,
  currency,
  onClose,
}: {
  contactId: string;
  contactName: string;
  kind: Kind;
  current: { amount: string; asOf: string; note: string | null } | null;
  currency: string;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const natural = naturalSide(kind);
  const currentAmount = Number(current?.amount ?? 0);

  const [side, setSide] = useState<Side>(
    currentAmount < 0 ? (natural === 'THEY_OWE' ? 'I_OWE' : 'THEY_OWE') : natural,
  );
  const [amount, setAmount] = useState(current ? Math.abs(currentAmount).toFixed(2) : '');
  const [asOf, setAsOf] = useState(current?.asOf ?? today());
  const [note, setNote] = useState(current?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (clear: boolean) => {
      setError(null);
      const magnitude = clear ? 0 : Math.abs(Number(amount));
      const signed = side === natural ? magnitude : -magnitude;
      return unwrap(
        await api.contacts.setOpeningBalance({
          params: { id: contactId },
          body: { amount: signed.toFixed(2), asOf, note: note || undefined },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success(t('Solde d’ouverture enregistré'));
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  const label = (value: Side) =>
    value === 'THEY_OWE' ? t('Il me doit') : t('Je lui dois');

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Solde d’ouverture')}
      description={contactName}
      footer={
        <>
          {current && (
            <Button variant="ghost" loading={save.isPending} onClick={() => save.mutate(true)}>
              {t('Supprimer')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!(Number(amount) > 0)}
            onClick={() => save.mutate(false)}
          >
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <p className="text-sm text-ink-muted">
          {t(
            'Dette qui existait déjà entre vous avant d’utiliser l’application (anciennes factures, prêt, avance). Elle apparaît dans le relevé, les encours et la comptabilité.',
          )}
        </p>
        <Field label={t('Qui doit à qui ?')}>
          <Segmented
            value={side}
            onChange={setSide}
            options={[
              { value: natural, label: label(natural) },
              { value: natural === 'THEY_OWE' ? 'I_OWE' : 'THEY_OWE', label: label(natural === 'THEY_OWE' ? 'I_OWE' : 'THEY_OWE') },
            ]}
          />
        </Field>
        <Field label={`${t('Montant')} (${currency})`} required>
          <NumberInput value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus />
        </Field>
        <Field label={t('À la date du')}>
          <Input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
        </Field>
        <Field label={t('Note')}>
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/**
 * Money exchanged with no invoice behind it: an advance, a loan, or a payment
 * against the opening balance. It can be applied to an invoice later.
 */
export function AdvanceDialog({
  contactId,
  contactName,
  kind,
  currency,
  onClose,
}: {
  contactId: string;
  contactName: string;
  kind: Kind;
  currency: string;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const methods = usePaymentMethods();
  const [direction, setDirection] = useState<'INBOUND' | 'OUTBOUND'>(
    kind === 'SUPPLIER' ? 'OUTBOUND' : 'INBOUND',
  );
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(today());
  const [note, setNote] = useState('');
  const [fields, setFields] = useState<MethodFieldsValue>(EMPTY_METHOD_FIELDS);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      const picked = methods.data?.find((entry) => entry.id === fields.methodId);
      return unwrap(
        await api.payments.create({
          body: {
            contactId,
            direction,
            method: picked?.kind ?? 'OTHER',
            methodId: fields.methodId || undefined,
            reference: fields.reference || undefined,
            bankName: fields.bankName || undefined,
            dueDate: fields.dueDate || undefined,
            amount,
            paidAt,
            note: note || undefined,
            allocations: [],
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success(t('Mouvement enregistré'));
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
      title={t('Avance, prêt ou règlement sans facture')}
      description={contactName}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!(Number(amount) > 0) || methodFieldsMissing(methods.data, fields)}
            onClick={() => save.mutate()}
          >
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <p className="text-sm text-ink-muted">
          {t(
            'Réduit (ou augmente) le solde du tiers sans être rattaché à une facture. Vous pourrez l’appliquer à une facture plus tard depuis la page Paiements.',
          )}
        </p>
        <Field label={t('Sens')}>
          <Segmented
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'INBOUND', label: t('J’ai reçu') },
              { value: 'OUTBOUND', label: t('J’ai versé') },
            ]}
          />
        </Field>
        <Field label={`${t('Montant')} (${currency})`} required>
          <NumberInput value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus />
        </Field>
        <Field label={t('Date')}>
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
