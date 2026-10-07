'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNote,
  Field,
  IconButton,
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

export default function ExchangeRatesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const companyId = activeCompanyId();
  const today = new Date().toISOString().slice(0, 10);

  const company = useQuery({
    queryKey: ['company', companyId],
    queryFn: async () => unwrap(await api.companies.get({ params: { id: companyId! } })),
    enabled: Boolean(companyId),
  });
  const companyCurrency = company.data?.defaultCurrency ?? 'MAD';

  const [base, setBase] = useState('EUR');
  const [quote, setQuote] = useState('');
  const [rate, setRate] = useState('');
  const [validFrom, setValidFrom] = useState(today);
  const [error, setError] = useState<string | null>(null);

  const rates = useQuery({
    queryKey: ['exchange-rates', 'all'],
    queryFn: async () => unwrap(await api.pricing.listExchangeRates({ query: {} })),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    void queryClient.invalidateQueries({ queryKey: ['exchange-rate'] });
  };
  const onError = (cause: unknown) =>
    setError(cause instanceof ApiError ? cause.message : t('Action impossible'));

  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.pricing.createExchangeRate({
          body: {
            baseCurrency: base.trim().toUpperCase(),
            quoteCurrency: (quote || companyCurrency).trim().toUpperCase(),
            rate: rate.trim().replace(',', '.'),
            validFrom,
          },
        }),
      ),
    onSuccess: () => {
      setError(null);
      setRate('');
      toast.success(t('Taux enregistré'));
      refresh();
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await api.pricing.removeExchangeRate({ params: { id } })),
    onSuccess: refresh,
    onError,
  });

  return (
    <>
      <PageHeader
        title={t('Taux de change')}
        subtitle={t('1 unité de la devise de base = taux × devise cotée. Le taux en vigueur à la date du document est figé sur celui-ci.')}
      />
      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <Card className="mb-4">
        <CardHeader title={t('Ajouter un taux')} />
        <form
          className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Field label={t('Devise de base')}>
            <Input value={base} maxLength={3} dir="ltr" onChange={(e) => setBase(e.target.value.toUpperCase())} />
          </Field>
          <Field label={t('Devise cotée')}>
            <Input
              value={quote}
              maxLength={3}
              dir="ltr"
              placeholder={companyCurrency}
              onChange={(e) => setQuote(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t('Taux')}>
            <NumberInput value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
          <Field label={t('En vigueur depuis')}>
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!rate.trim() || base.length !== 3}>
            <Icon name="plus" />
            {t('Ajouter')}
          </Button>
        </form>
      </Card>

      <Card>
        <CardHeader title={t('Historique des taux')} />
        {rates.isLoading ? (
          <TableSkeleton rows={4} cols={4} />
        ) : (rates.data ?? []).length === 0 ? (
          <EmptyState icon="trending" title={t('Aucun taux de change')} description={t('Ajoutez un taux pour émettre des documents dans une autre devise.')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('Paire')}</Th>
                <Th numeric>{t('Taux')}</Th>
                <Th>{t('En vigueur depuis')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(rates.data ?? []).map((row) => (
                <tr key={row.id}>
                  <Td className="font-medium" dir="ltr">
                    1 {row.baseCurrency} → {row.quoteCurrency}
                  </Td>
                  <Td numeric>{row.rate}</Td>
                  <Td>{row.validFrom}</Td>
                  <Td className="text-end">
                    <IconButton label={t('Retirer')} onClick={() => remove.mutate(row.id)}>
                      <Icon name="x" />
                    </IconButton>
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
