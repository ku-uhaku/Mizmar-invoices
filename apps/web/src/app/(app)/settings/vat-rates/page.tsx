'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import {
  Button,
  Card,
  CardHeader,
  Checkbox,
  ErrorNote,
  Input,
  NumberInput,
  PageHeader,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { api, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { activeCompanyId } from '@/lib/session-client';

interface Row {
  rate: string;
  label: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

export default function VatRatesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const companyId = activeCompanyId();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rates = useQuery({
    queryKey: ['vat-rates', companyId],
    queryFn: async () => unwrap(await api.companies.listVatRates({ params: { id: companyId! } })),
    enabled: Boolean(companyId),
  });

  useEffect(() => {
    if (rates.data) setRows(rates.data.map(({ id: _id, ...rest }) => rest));
  }, [rates.data]);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      const list = rows ?? [];
      if (list.some((row) => !row.label.trim() || row.rate.trim() === '' || Number.isNaN(Number(row.rate)))) {
        throw new ApiError(400, 'INVALID', t('Chaque taux doit avoir un libellé et une valeur numérique'));
      }
      const defaults = list.filter((row) => row.isDefault).length;
      if (defaults > 1) {
        throw new ApiError(400, 'INVALID', t('Un seul taux peut être le taux par défaut'));
      }
      return unwrap(
        await api.companies.replaceVatRates({
          params: { id: companyId! },
          body: { rates: list.map((row, index) => ({ ...row, rate: row.rate.trim(), sortOrder: index })) },
        }),
      );
    },
    onSuccess: () => {
      toast.success(t('Taux de TVA enregistrés'));
      void queryClient.invalidateQueries({ queryKey: ['vat-rates'] });
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  const patch = (index: number, value: Partial<Row>) =>
    setRows((current) =>
      (current ?? []).map((row, i) => {
        if (i === index) return { ...row, ...value };
        // Only one default at a time.
        return value.isDefault ? { ...row, isDefault: false } : row;
      }),
    );

  return (
    <>
      <PageHeader
        title={t('Taux de TVA')}
        subtitle={t('Les taux proposés sur les lignes de document')}
        actions={
          <>
            <Button
              onClick={() =>
                setRows((current) => [
                  ...(current ?? []),
                  { rate: '20', label: '', isDefault: false, isActive: true, sortOrder: current?.length ?? 0 },
                ])
              }
            >
              <Icon name="plus" />
              {t('Ajouter un taux')}
            </Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()} disabled={!rows}>
              <Icon name="check" />
              {t('Enregistrer')}
            </Button>
          </>
        }
      />
      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <Card>
        <CardHeader title={t('Taux')} description={t('Un taux désactivé reste valable sur les documents existants')} />
        {!rows ? (
          <TableSkeleton rows={4} cols={5} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('Libellé')}</Th>
                <Th numeric>{t('Taux (%)')}</Th>
                <Th>{t('Par défaut')}</Th>
                <Th>{t('Actif')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <Td>
                    <Input value={row.label} onChange={(e) => patch(index, { label: e.target.value })} />
                  </Td>
                  <Td numeric>
                    <NumberInput
                      className="w-24"
                      value={row.rate}
                      onChange={(e) => patch(index, { rate: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <Checkbox label={<span className="sr-only">{t('Par défaut')}</span>} checked={row.isDefault} onChange={(e) => patch(index, { isDefault: e.target.checked })} />
                  </Td>
                  <Td>
                    <Checkbox label={<span className="sr-only">{t('Actif')}</span>} checked={row.isActive} onChange={(e) => patch(index, { isActive: e.target.checked })} />
                  </Td>
                  <Td className="text-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRows((current) => (current ?? []).filter((_, i) => i !== index))}
                    >
                      {t('Retirer')}
                    </Button>
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
