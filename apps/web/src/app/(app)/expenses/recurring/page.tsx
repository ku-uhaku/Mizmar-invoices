'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { expenseSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { api, ApiError, unwrap } from '@/lib/api';
import { useExpenseCategories, useSuppliers } from '@/components/expense-dialogs';
import { Icon } from '@/components/icons';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  IconButton,
  Input,
  NumberInput,
  PageHeader,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { date, money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

type Recurring = z.infer<typeof expenseSchemas.recurringExpense>;
type Frequency = Recurring['frequency'];

const FREQUENCIES: Array<[Frequency, string]> = [
  ['MONTHLY', 'Mensuelle'],
  ['QUARTERLY', 'Trimestrielle'],
  ['YEARLY', 'Annuelle'],
  ['WEEKLY', 'Hebdomadaire'],
];

export default function RecurringExpensesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null);
  const [toRemove, setToRemove] = useState<Recurring | null>(null);

  const list = useQuery({
    queryKey: ['expenses', 'recurring'],
    queryFn: async () => unwrap(await api.expenses.listRecurring({})),
  });

  const generate = useMutation({
    mutationFn: async () => unwrap(await api.expenses.generateRecurring({ body: {} })),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success(t('{n} facture(s) générée(s)', { n: result.generated }));
    },
    onError: (cause) =>
      toast.error(cause instanceof ApiError ? cause.message : t('Génération impossible')),
  });

  const toggle = useMutation({
    mutationFn: async (item: Recurring) =>
      unwrap(
        await api.expenses.updateRecurring({ params: { id: item.id }, body: { isActive: !item.isActive } }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['expenses'] }),
    onError: (cause) => toast.error(cause instanceof ApiError ? cause.message : t('Erreur')),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await api.expenses.removeRecurring({ params: { id } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setToRemove(null);
    },
    onError: (cause) => {
      setToRemove(null);
      toast.error(cause instanceof ApiError ? cause.message : t('Suppression impossible'));
    },
  });

  return (
    <>
      <PageHeader
        title={t('Charges récurrentes')}
        subtitle={t('Une facture est créée automatiquement à chaque échéance ; corrigez le montant à réception.')}
        actions={
          <>
            <Link
              href="/expenses"
              className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              {t('Retour aux factures')}
            </Link>
            <Button variant="secondary" loading={generate.isPending} onClick={() => generate.mutate()}>
              {t('Générer maintenant')}
            </Button>
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Icon name="plus" className="size-4" />
              {t('Nouvelle charge')}
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        {list.isPending ? (
          <TableSkeleton rows={4} cols={6} />
        ) : list.data && list.data.length > 0 ? (
          <Table className="min-w-[760px]">
            <thead>
              <tr>
                <Th>{t('Libellé')}</Th>
                <Th>{t('Catégorie')}</Th>
                <Th>{t('Fréquence')}</Th>
                <Th>{t('Prochaine facture')}</Th>
                <Th numeric>{t('Montant HT')}</Th>
                <Th>{t('Actif')}</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((item) => (
                <tr key={item.id} className="hover:bg-surface-muted/60">
                  <Td>
                    <button
                      type="button"
                      className="font-medium text-ink hover:text-brand"
                      onClick={() => setEditing(item)}
                    >
                      {item.name}
                    </button>
                    {item.supplierName && <div className="text-xs text-ink-muted">{item.supplierName}</div>}
                  </Td>
                  <Td className="text-ink-muted">{t(item.categoryName)}</Td>
                  <Td>
                    <Badge>{t(FREQUENCIES.find(([value]) => value === item.frequency)?.[1] ?? item.frequency)}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {item.nextRunAt ? date(item.nextRunAt) : t('Terminée')}
                  </Td>
                  <Td numeric>{money(item.amountExclVat, item.currency)}</Td>
                  <Td>
                    <Checkbox label={t('Actif')} checked={item.isActive} onChange={() => toggle.mutate(item)} />
                  </Td>
                  <Td>
                    <IconButton
                      label={t('Supprimer')}
                      onClick={() => setToRemove(item)}
                      className="hover:bg-danger-soft hover:text-danger"
                    >
                      <Icon name="x" />
                    </IconButton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon="clock"
            title={t('Aucune charge récurrente')}
            description={t('Ajoutez votre loyer, l’électricité ou l’internet pour ne plus rien oublier.')}
          />
        )}
      </Card>

      {editing && (
        <RecurringDialog item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
      {toRemove && (
        <Dialog
          open
          onClose={() => setToRemove(null)}
          title={t('Supprimer cette charge récurrente ?')}
          description={t('Les factures déjà générées sont conservées.')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setToRemove(null)}>
                {t('Annuler')}
              </Button>
              <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(toRemove.id)}>
                {t('Supprimer')}
              </Button>
            </>
          }
        >
          <></>
        </Dialog>
      )}
    </>
  );
}

function RecurringDialog({ item, onClose }: { item?: Recurring; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const categories = useExpenseCategories();
  const suppliers = useSuppliers();

  const [name, setName] = useState(item?.name ?? '');
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? '');
  const [supplierId, setSupplierId] = useState(item?.supplierId ?? '');
  const [amountExclVat, setAmount] = useState(item?.amountExclVat ?? '');
  const [vatRate, setVatRate] = useState(item ? String(Number(item.vatRate)) : '20');
  const [frequency, setFrequency] = useState<Frequency>(item?.frequency ?? 'MONTHLY');
  const [dueInDays, setDueInDays] = useState(String(item?.dueInDays ?? 15));
  const [startDate, setStartDate] = useState(item?.startDate ?? new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      const body = {
        name,
        categoryId,
        supplierId: supplierId || null,
        amountExclVat,
        vatRate,
        frequency,
        dueInDays: Number(dueInDays) || 0,
        startDate,
      };
      return item
        ? unwrap(await api.expenses.updateRecurring({ params: { id: item.id }, body }))
        : unwrap(await api.expenses.createRecurring({ body }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  const valid = name.trim() !== '' && categoryId !== '' && amountExclVat !== '';

  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? t('Modifier la charge') : t('Nouvelle charge récurrente')}
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
        <Field label={t('Libellé')} required>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Wifi Maroc Telecom" />
        </Field>
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
          <Field label={t('Montant HT estimé')} required>
            <NumberInput value={amountExclVat} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label={t('TVA')}>
            <Select value={vatRate} onChange={(event) => setVatRate(event.target.value)}>
              {[...new Set(['0', '7', '10', '14', '20', vatRate])].map((rate) => (
                <option key={rate} value={rate}>
                  {rate} %
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('Fréquence')}>
            <Select value={frequency} onChange={(event) => setFrequency(event.target.value as Frequency)}>
              {FREQUENCIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('Première facture le')}>
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label={t('Échéance (jours après la facture)')}>
            <NumberInput value={dueInDays} onChange={(event) => setDueInDays(event.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
