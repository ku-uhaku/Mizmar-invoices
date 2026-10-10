'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { expenseSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { api, ApiError, unwrap } from '@/lib/api';
import { money, paymentMethodLabel } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { Button, Dialog, ErrorNote, Field, Input, NumberInput, Select, toast } from './ui';

export type Expense = z.infer<typeof expenseSchemas.expense>;

const METHODS = ['BANK_TRANSFER', 'CASH', 'CHEQUE', 'CARD', 'BILL_OF_EXCHANGE', 'OTHER'] as const;
const VAT_RATES = ['0', '7', '10', '14', '20'];
const today = () => new Date().toISOString().slice(0, 10);

export function useExpenseCategories() {
  return useQuery({
    queryKey: ['expenses', 'categories'],
    queryFn: async () => unwrap(await api.expenses.listCategories({})),
  });
}

export function useSuppliers() {
  return useQuery({
    queryKey: ['contacts', 'suppliers'],
    queryFn: async () => unwrap(await api.contacts.list({ query: { kind: 'SUPPLIER', limit: 100 } })),
  });
}

/** Create or edit a bill. */
export function ExpenseDialog({ expense, onClose }: { expense?: Expense; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const categories = useExpenseCategories();
  const suppliers = useSuppliers();

  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? '');
  const [supplierId, setSupplierId] = useState(expense?.supplierId ?? '');
  const [reference, setReference] = useState(expense?.reference ?? '');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [issueDate, setIssueDate] = useState(expense?.issueDate ?? today());
  const [dueDate, setDueDate] = useState(expense?.dueDate ?? '');
  const [periodStart, setPeriodStart] = useState(expense?.periodStart ?? '');
  const [periodEnd, setPeriodEnd] = useState(expense?.periodEnd ?? '');
  const [amountExclVat, setAmount] = useState(expense?.amountExclVat ?? '');
  const [vatRate, setVatRate] = useState(expense ? String(Number(expense.vatRate)) : '20');
  const [error, setError] = useState<string | null>(null);

  const net = Number(amountExclVat) || 0;
  const vat = Math.round(net * Number(vatRate)) / 100;

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      const body = {
        categoryId,
        supplierId: supplierId || null,
        reference: reference || null,
        description: description || null,
        issueDate,
        dueDate: dueDate || null,
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        amountExclVat,
        vatRate,
      };
      return expense
        ? unwrap(await api.expenses.update({ params: { id: expense.id }, body }))
        : unwrap(await api.expenses.create({ body }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success(t('Facture enregistrée'));
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  const removePayment = useMutation({
    mutationFn: async (paymentId: string) =>
      unwrap(await api.expenses.removePayment({ params: { id: expense!.id, paymentId } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success(t('Règlement supprimé'));
      onClose();
    },
    onError: (cause) =>
      toast.error(cause instanceof ApiError ? cause.message : t('Suppression impossible')),
  });

  const valid = categoryId !== '' && issueDate !== '' && amountExclVat !== '' && net >= 0;

  return (
    <Dialog
      open
      onClose={onClose}
      title={expense ? t('Modifier la facture') : t('Nouvelle facture / dépense')}
      description={t('Électricité, eau, internet, loyer, assurance…')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Catégorie')} required>
            <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">{t('Choisir…')}</option>
              {categories.data
                ?.filter((category) => category.isActive || category.id === categoryId)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {t(category.name)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('Fournisseur')}>
            <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">{t('— Aucun —')}</option>
              {suppliers.data?.items.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.displayName}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('N° de facture du fournisseur')}>
            <Input value={reference} onChange={(event) => setReference(event.target.value)} />
          </Field>
          <Field label={t('Libellé')}>
            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Date de la facture')} required>
            <Input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
          </Field>
          <Field label={t('Échéance')}>
            <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
          <Field label={t('Période — début')} hint={t('Période de consommation')}>
            <Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
          </Field>
          <Field label={t('Période — fin')}>
            <Input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Montant HT')} required>
            <NumberInput value={amountExclVat} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label={t('TVA')}>
            <Select value={vatRate} onChange={(event) => setVatRate(event.target.value)}>
              {[...new Set([...VAT_RATES, vatRate])].map((rate) => (
                <option key={rate} value={rate}>
                  {rate} %
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {expense && expense.payments.length > 0 && (
          <div className="rounded-xl border border-border">
            <div className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
              {t('Règlements')}
            </div>
            {expense.payments.map((payment) => (
              <div
                key={payment.id}
                className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
              >
                <span className="text-ink-muted">
                  {payment.paidAt} · {paymentMethodLabel(payment.method)}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular font-medium">{money(payment.amount, expense.currency)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={removePayment.isPending}
                    onClick={() => removePayment.mutate(payment.id)}
                  >
                    {t('Supprimer')}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-xl bg-brand-soft px-4 py-3">
          <span className="text-sm font-medium text-brand">{t('Total TTC')}</span>
          <span className="tabular text-lg font-semibold text-ink">
            {money((net + vat).toFixed(2), expense?.currency ?? 'MAD')}
          </span>
        </div>
      </div>
    </Dialog>
  );
}

/** Record a payment against a bill. */
export function ExpensePayDialog({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(expense.outstanding);
  const [method, setMethod] = useState<(typeof METHODS)[number]>('BANK_TRANSFER');
  const [paidAt, setPaidAt] = useState(today());
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pay = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await api.expenses.pay({
          params: { id: expense.id },
          body: { method, amount, paidAt, reference: reference || null },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success(t('Règlement enregistré'));
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  const over = Number(amount) > Number(expense.outstanding);

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Payer cette facture')}
      description={expense.description ?? expense.categoryName}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant="primary"
            loading={pay.isPending}
            disabled={Number(amount) <= 0 || over}
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
          <span className="tabular text-lg font-semibold text-ink">
            {money(expense.outstanding, expense.currency)}
          </span>
        </div>
        <Field label={t('Montant')} required error={over ? t('Supérieur au reste dû') : undefined}>
          <NumberInput value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Moyen de paiement')}>
            <Select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
              {METHODS.map((value) => (
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
      </div>
    </Dialog>
  );
}
