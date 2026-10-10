'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { accountingSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { apiModules, ApiError, unwrap } from '@/lib/api';
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
import { amount } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { ACCOUNTS_KEY, useAccounts } from '@/lib/use-accounting';

type Type = z.infer<typeof accountingSchemas.accountTypeEnum>;

const TYPES: Array<[Type, string]> = [
  ['ASSET', 'Comptes d’actif'],
  ['LIABILITY', 'Comptes de passif'],
  ['EQUITY', 'Capitaux propres'],
  ['INCOME', 'Produits'],
  ['EXPENSE', 'Charges'],
];

export default function AccountsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<Type>('EXPENSE');

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
  const fail = (cause: unknown) => toast.error(cause instanceof ApiError ? cause.message : t('Enregistrement impossible'));

  const create = useMutation({
    mutationFn: async () =>
      unwrap(await apiModules.accounting.createAccount({ body: { code: code.trim(), name: name.trim(), type, isActive: true } })),
    onSuccess: () => {
      setCode('');
      setName('');
      refresh();
    },
    onError: fail,
  });

  const patch = useMutation({
    mutationFn: async (input: { id: string; body: { isActive?: boolean } }) =>
      unwrap(await apiModules.accounting.updateAccount({ params: { id: input.id }, body: input.body })),
    onSuccess: refresh,
    onError: fail,
  });

  return (
    <>
      <PageHeader title={t('Plan comptable')} subtitle={t('Les comptes utilisés par vos écritures')} />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr_12rem_auto] sm:items-end">
          <Field label={t('Compte')}>
            <Input value={code} inputMode="numeric" onChange={(event) => setCode(event.target.value)} />
          </Field>
          <Field label={t('Intitulé')}>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t('Type')}>
            <Select value={type} onChange={(event) => setType(event.target.value as Type)}>
              {TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" loading={create.isPending} disabled={!/^\d{3,10}$/.test(code.trim()) || !name.trim()} onClick={() => create.mutate()}>
            {t('Ajouter')}
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {accounts.isPending ? (
          <TableSkeleton rows={8} cols={5} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('Compte')}</Th>
                <Th>{t('Intitulé')}</Th>
                <Th>{t('Type')}</Th>
                <Th numeric>{t('Solde')}</Th>
                <Th>{t('Actif')}</Th>
              </tr>
            </thead>
            <tbody>
              {accounts.data?.map((account) => (
                <tr key={account.id} className="hover:bg-surface-muted/60">
                  <Td className="font-mono text-sm">
                    <Link href={`/accounting/ledger?account=${account.id}`} className="text-brand hover:underline">
                      {account.code}
                    </Link>
                  </Td>
                  <Td className="font-medium">
                    {t(account.name)}
                    {account.role && <Badge className="ms-2">{t('Automatique')}</Badge>}
                  </Td>
                  <Td className="text-ink-muted">{t(TYPES.find(([value]) => value === account.type)?.[1] ?? account.type)}</Td>
                  <Td numeric className="font-semibold">{amount(account.balance)}</Td>
                  <Td>
                    <Checkbox
                      label={t('Actif')}
                      checked={account.isActive}
                      disabled={Boolean(account.role)}
                      onChange={() => patch.mutate({ id: account.id, body: { isActive: !account.isActive } })}
                    />
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
