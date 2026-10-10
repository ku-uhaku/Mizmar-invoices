'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { catalogSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { api, apiModules, ApiError, unwrap } from '@/lib/api';
import { Barcode } from '@/components/barcode';
import { Icon } from '@/components/icons';
import { Button, Card, Checkbox, EmptyState, Field, IconButton, NumberInput, PageHeader, SearchInput, Select, toast } from '@/components/ui';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

type Found = z.infer<typeof catalogSchemas.variantSearchResult>;

interface Row {
  variantId: string;
  name: string;
  sku: string;
  variantLabel: string | null;
  barcode: string | null;
  price: string | null;
  copies: number;
}

/** Label sizes in millimetres: width, height, and how many fit across an A4 sheet. */
const SIZES = {
  '50x30': { w: 50, h: 30, label: '50 × 30 mm' },
  '40x25': { w: 40, h: 25, label: '40 × 25 mm' },
  '60x40': { w: 60, h: 40, label: '60 × 40 mm' },
} as const;
type SizeKey = keyof typeof SIZES;

export default function LabelsPage() {
  const t = useT();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [size, setSize] = useState<SizeKey>('50x30');
  const [showName, setShowName] = useState(true);
  const [showSku, setShowSku] = useState(true);
  const [showPrice, setShowPrice] = useState(true);

  const results = useQuery({
    queryKey: ['labels', 'search', query],
    enabled: query.trim().length > 0,
    queryFn: async () => unwrap(await api.catalog.searchVariants({ query: { q: query.trim(), limit: 10 } })),
  });

  function add(found: Found) {
    setRows((current) =>
      current.some((row) => row.variantId === found.variantId)
        ? current
        : [
            ...current,
            {
              variantId: found.variantId,
              name: found.productName,
              sku: found.sku,
              variantLabel: found.variantLabel,
              barcode: found.barcode,
              price: found.sellingPrice ?? null,
              copies: 1,
            },
          ],
    );
    setQuery('');
  }

  const missing = rows.filter((row) => !row.barcode);
  const generate = useMutation({
    mutationFn: async () =>
      unwrap(await apiModules.lots.generateBarcodes({ body: { variantIds: missing.map((row) => row.variantId) } })),
    onSuccess: (assigned) => {
      const byId = new Map(assigned.map((entry) => [entry.variantId, entry.barcode]));
      setRows((current) => current.map((row) => ({ ...row, barcode: byId.get(row.variantId) ?? row.barcode })));
      toast.success(t('{n} code(s)-barres créé(s)', { n: assigned.length }));
    },
    onError: (cause) => toast.error(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  const labels = rows.flatMap((row) => Array.from({ length: row.copies }, () => row)).filter((row) => row.barcode);
  const dims = SIZES[size];

  return (
    <>
      <PageHeader
        title={t('Étiquettes code-barres')}
        subtitle={t('Choisissez les articles, le format, puis imprimez')}
        actions={
          <Button variant="primary" disabled={labels.length === 0} onClick={() => window.print()}>
            <Icon name="printer" /> {t('Imprimer')} ({labels.length})
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4 print:hidden">
          <Card className="p-4">
            <Field label={t('Ajouter un article')}>
              <SearchInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('Nom, SKU ou code-barres…')}
              />
            </Field>
            {query.trim() && (
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {(results.data ?? []).length === 0 && !results.isPending && (
                  <li className="px-3 py-2 text-sm text-ink-muted">{t('Aucun résultat')}</li>
                )}
                {(results.data ?? []).map((found) => (
                  <li key={found.variantId}>
                    <button
                      type="button"
                      onClick={() => add(found)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-surface-muted"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {found.productName}
                        <span className="block text-xs text-ink-subtle">
                          {found.sku}
                          {found.variantLabel ? ` · ${found.variantLabel}` : ''}
                        </span>
                      </span>
                      <Icon name="plus" className="text-brand" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <Field label={t('Format')}>
              <Select value={size} onChange={(event) => setSize(event.target.value as SizeKey)}>
                {(Object.keys(SIZES) as SizeKey[]).map((key) => (
                  <option key={key} value={key}>
                    {SIZES[key].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Checkbox label={t('Nom de l’article')} checked={showName} onChange={(event) => setShowName(event.target.checked)} />
            <Checkbox label="SKU" checked={showSku} onChange={(event) => setShowSku(event.target.checked)} />
            <Checkbox label={t('Prix de vente')} checked={showPrice} onChange={(event) => setShowPrice(event.target.checked)} />
          </Card>

          <Card className="p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              {t('Articles ({n})', { n: rows.length })}
            </p>
            {rows.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('Aucun article choisi.')}</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((row) => (
                  <li key={row.variantId} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {row.name}
                      <span className="block text-xs text-ink-subtle">
                        {row.barcode ?? <span className="text-warning">{t('Pas de code-barres')}</span>}
                      </span>
                    </span>
                    <NumberInput
                      className="w-16"
                      value={String(row.copies)}
                      onChange={(event) => {
                        const copies = Math.max(1, Math.min(500, Math.floor(Number(event.target.value) || 1)));
                        setRows((current) => current.map((entry) => (entry.variantId === row.variantId ? { ...entry, copies } : entry)));
                      }}
                    />
                    <IconButton label={t('Retirer')} onClick={() => setRows((current) => current.filter((entry) => entry.variantId !== row.variantId))}>
                      <Icon name="x" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            {missing.length > 0 && (
              <Button className="mt-3 w-full" loading={generate.isPending} onClick={() => generate.mutate()}>
                {t('Créer les {n} code(s) manquant(s)', { n: missing.length })}
              </Button>
            )}
          </Card>
        </div>

        <Card className="p-4 print:border-0 print:p-0 print:shadow-none">
          {labels.length === 0 ? (
            <EmptyState
              icon="tag"
              title={t('Aperçu des étiquettes')}
              description={t('Ajoutez des articles ayant un code-barres : les étiquettes apparaissent ici.')}
            />
          ) : (
            <div className="label-sheet flex flex-wrap gap-2 p-1">
              {labels.map((label, index) => (
                <div
                  key={`${label.variantId}-${index}`}
                  className="label-cell flex flex-col items-center justify-between overflow-hidden rounded border border-dashed border-border-strong bg-white p-[1.5mm] text-center text-black"
                  style={{ width: `${dims.w}mm`, height: `${dims.h}mm` }}
                >
                  {showName && (
                    <p className="w-full truncate text-[8pt] font-semibold leading-tight">
                      {label.name}
                      {label.variantLabel ? ` · ${label.variantLabel}` : ''}
                    </p>
                  )}
                  <Barcode value={label.barcode!} height={36} className="min-h-0 w-full flex-1" />
                  <div className="flex w-full items-center justify-between text-[7pt] leading-tight">
                    {showSku ? <span className="truncate">{label.sku}</span> : <span />}
                    {showPrice && label.price && <span className="font-bold">{money(label.price)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
