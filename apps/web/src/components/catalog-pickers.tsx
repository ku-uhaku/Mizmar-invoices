'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { Combobox } from './combobox';
import { toast } from './ui';

/** Brand or category: pick one already used on a product, or type a new one. */
export function FacetPicker({
  kind,
  value,
  onChange,
}: {
  kind: 'categories' | 'brands';
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const facets = useQuery({
    queryKey: ['product-facets'],
    queryFn: async () => unwrap(await api.catalog.productFacets()),
  });
  const names = facets.data?.[kind] ?? [];
  const options = (value && !names.includes(value) ? [value, ...names] : names).map((name) => ({
    value: name,
    label: name,
  }));

  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={options}
      selectedLabel={value || undefined}
      loading={facets.isPending}
      clearable
      placeholder={kind === 'brands' ? t('Choisir une marque') : t('Choisir une catégorie')}
      onCreate={onChange}
    />
  );
}

/** Unit of measure, from the company's units; a new one can be created on the spot. */
export function UnitPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (unitId: string) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const units = useQuery({
    queryKey: ['units'],
    queryFn: async () => unwrap(await api.catalog.listUnits()),
  });

  const create = useMutation({
    mutationFn: async (code: string) => unwrap(await api.catalog.createUnit({ body: { code } })),
    onSuccess: (unit) => {
      void queryClient.invalidateQueries({ queryKey: ['units'] });
      onChange(unit.id);
    },
    onError: (cause) =>
      toast.error(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={(units.data ?? []).map((unit) => ({
        value: unit.id,
        label: unit.name,
        description: unit.code,
      }))}
      loading={units.isPending || create.isPending}
      clearable
      placeholder={t('Choisir une unité')}
      onCreate={(code) => create.mutate(code)}
    />
  );
}
