'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { expenseSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { api, ApiError, unwrap } from '@/lib/api';
import { useExpenseCategories } from '@/components/expense-dialogs';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  PageHeader,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

type Kind = z.infer<typeof expenseSchemas.expenseCategoryKindEnum>;

const KINDS: Array<[Kind, string]> = [
  ['UTILITY', 'Énergie, eau, télécoms'],
  ['RENT', 'Loyer'],
  ['INSURANCE', 'Assurance'],
  ['FUEL', 'Carburant'],
  ['SUPPLIES', 'Fournitures'],
  ['SALARY', 'Salaires'],
  ['TAX', 'Impôts et taxes'],
  ['OTHER', 'Autre'],
];

export default function ExpenseCategoriesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const categories = useExpenseCategories();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('OTHER');

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['expenses', 'categories'] });
  const fail = (cause: unknown) =>
    toast.error(cause instanceof ApiError ? cause.message : t('Enregistrement impossible'));

  const create = useMutation({
    mutationFn: async () => unwrap(await api.expenses.createCategory({ body: { name: name.trim(), kind } })),
    onSuccess: () => {
      setName('');
      refresh();
    },
    onError: fail,
  });

  const toggle = useMutation({
    mutationFn: async (category: { id: string; isActive: boolean }) =>
      unwrap(
        await api.expenses.updateCategory({
          params: { id: category.id },
          body: { isActive: !category.isActive },
        }),
      ),
    onSuccess: refresh,
    onError: fail,
  });

  return (
    <>
      <PageHeader
        title={t('Catégories de dépenses')}
        subtitle={t('Utilisées pour classer vos factures et dans les rapports')}
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
          <Field label={t('Nom')}>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t('Type')}>
            <Select value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
              {KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={name.trim() === ''}
            onClick={() => create.mutate()}
          >
            {t('Ajouter')}
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {categories.isPending ? (
          <TableSkeleton rows={6} cols={3} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('Nom')}</Th>
                <Th>{t('Type')}</Th>
                <Th>{t('Actif')}</Th>
              </tr>
            </thead>
            <tbody>
              {categories.data?.map((category) => (
                <tr key={category.id}>
                  <Td className="font-medium">{t(category.name)}</Td>
                  <Td>
                    <Badge>{t(KINDS.find(([value]) => value === category.kind)?.[1] ?? category.kind)}</Badge>
                  </Td>
                  <Td>
                    <Checkbox label={t('Actif')} checked={category.isActive} onChange={() => toggle.mutate(category)} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
