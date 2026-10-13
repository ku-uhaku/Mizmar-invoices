'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { AttributeTypeDialog } from '@/components/attribute-type-dialog';
import { FacetPicker, UnitPicker } from '@/components/catalog-pickers';
import { Icon } from '@/components/icons';
import { StagedImagePicker } from '@/components/product-images';
import {
  Button,
  Card,
  CardHeader,
  ErrorNote,
  Field,
  Input,
  NumberInput,
  PageHeader,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  toast,
} from '@/components/ui';
import { generateEan13 } from '@/lib/ean13';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { uploadProductImages } from '@/lib/product-images';

interface RowEdit {
  excluded?: boolean;
  sku?: string;
  barcode?: string;
  sellingPrice?: string;
  costPrice?: string;
  stock?: string;
}

const num = (value: string) => {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const autoSku = (reference: string, name: string) =>
  (reference || name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

export default function NewProductPage() {
  // Bumping the key remounts the form, which is how "create and add another" starts clean.
  const [formKey, setFormKey] = useState(0);
  return <ProductForm key={formKey} onAnother={() => setFormKey((value) => value + 1)} />;
}

function ProductForm({ onAnother }: { onAnother: () => void }) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [isService, setIsService] = useState(false);
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [unitId, setUnitId] = useState('');
  const [description, setDescription] = useState('');
  const [vatRate, setVatRate] = useState('20');
  const [sellingPrice, setSellingPrice] = useState('0');
  const [costPrice, setCostPrice] = useState('0');
  const [threshold, setThreshold] = useState('0');
  const [hasVariants, setHasVariants] = useState(false);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [simpleSku, setSimpleSku] = useState('');
  const [simpleBarcode, setSimpleBarcode] = useState('');
  const [simpleStock, setSimpleStock] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [attributeOpen, setAttributeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attributes = useQuery({
    queryKey: ['attribute-types'],
    queryFn: async () => unwrap(await api.catalog.listAttributeTypes()),
  });
  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => unwrap(await api.inventory.listWarehouses()),
  });
  const activeWarehouses = (warehouses.data ?? []).filter((warehouse) => warehouse.isActive);
  useEffect(() => {
    if (!warehouseId && activeWarehouses[0]) setWarehouseId(activeWarehouses[0].id);
  }, [warehouseId, activeWarehouses]);

  const dimensions = Object.entries(selected)
    .filter(([, values]) => values.length > 0)
    .map(([attributeTypeId, attributeValueIds]) => ({ attributeTypeId, attributeValueIds }));
  const skuPrefix = autoSku(reference, name) || 'PRD';

  // The matrix only depends on the chosen dimensions: prices and edits are
  // applied on top of it here, so typing a price never refetches the table.
  const matrix = useQuery({
    queryKey: ['variant-matrix', dimensions, skuPrefix],
    queryFn: async () =>
      unwrap(await api.catalog.variantMatrix({ body: { skuPrefix, dimensions } })),
    enabled: hasVariants && !isService && dimensions.length > 0,
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(
    () =>
      (hasVariants && !isService && dimensions.length > 0 ? (matrix.data?.combinations ?? []) : []).map(
        (combination) => {
          const key = combination.attributeValueIds.join(',');
          const edit = edits[key] ?? {};
          return {
            key,
            combination,
            included: !edit.excluded,
            sku: edit.sku ?? combination.suggestedSku,
            barcode: edit.barcode ?? '',
            sellingPrice: edit.sellingPrice ?? sellingPrice,
            costPrice: edit.costPrice ?? costPrice,
            stock: edit.stock ?? '',
          };
        },
      ),
    [matrix.data, edits, sellingPrice, costPrice, hasVariants, isService, dimensions.length],
  );
  const included = rows.filter((row) => row.included);
  const patchRow = (key: string, patch: RowEdit) =>
    setEdits((current) => ({ ...current, [key]: { ...current[key], ...patch } }));

  const selling = num(sellingPrice);
  const cost = num(costPrice);
  const margin = selling - cost;
  const marginPct = selling > 0 ? (margin / selling) * 100 : 0;
  const priceTtc = selling * (1 + num(vatRate) / 100);

  const variantMode = hasVariants && !isService;
  const needsDimensions = variantMode && included.length === 0;
  const canSave = Boolean(name.trim()) && !needsDimensions;

  const create = useMutation({
    mutationFn: async (another: boolean) => {
      setError(null);
      const stockFor = (value: string) => {
        const quantity = num(value);
        return quantity > 0 && warehouseId && !isService
          ? { openingStock: [{ warehouseId, quantity: String(quantity) }] }
          : {};
      };
      const variants =
        variantMode && included.length > 0
          ? included.map((row) => ({
              sku: row.sku.trim(),
              ...(row.barcode.trim() ? { barcode: row.barcode.trim() } : {}),
              attributeValueIds: row.combination.attributeValueIds,
              sellingPrice: row.sellingPrice || '0',
              costPrice: row.costPrice || '0',
              minStockThreshold: threshold || '0',
              isActive: true,
              ...stockFor(row.stock),
            }))
          : [
              {
                sku: simpleSku.trim() || autoSku(reference, name) || 'PRD',
                ...(simpleBarcode.trim() ? { barcode: simpleBarcode.trim() } : {}),
                attributeValueIds: [],
                sellingPrice: sellingPrice || '0',
                costPrice: costPrice || '0',
                minStockThreshold: isService ? '0' : threshold || '0',
                isActive: true,
                ...stockFor(simpleStock),
              },
            ];

      const created = unwrap(
        await api.catalog.createProduct({
          body: {
            name: name.trim(),
            reference: reference.trim() || undefined,
            category: category || undefined,
            brand: brand || undefined,
            unitId: unitId || undefined,
            description: description.trim() || undefined,
            defaultVatRate: vatRate || '0',
            isVariantManaged: variantMode,
            isService,
            attributeTypeIds: variantMode ? dimensions.map((dimension) => dimension.attributeTypeId) : [],
            variants,
          },
        }),
      );
      return { created, another };
    },
    onSuccess: async ({ created, another }) => {
      if (photos.length > 0) {
        try {
          await uploadProductImages(created.id, photos);
        } catch {
          toast.error(t('Produit créé, mais les photos n’ont pas pu être envoyées. Ajoutez-les via « Modifier ».'));
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['product-facets'] });
      toast.success(t('Produit créé'));
      if (another) {
        window.scrollTo({ top: 0 });
        onAnother();
      } else {
        router.push('/products');
      }
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Création impossible')),
  });

  const toggleValue = (attributeId: string, valueId: string) =>
    setSelected((current) => {
      const existing = current[attributeId] ?? [];
      return {
        ...current,
        [attributeId]: existing.includes(valueId)
          ? existing.filter((id) => id !== valueId)
          : [...existing, valueId],
      };
    });

  const saveLabel = variantMode && included.length > 0
    ? t('Créer le produit ({n} variantes)', { n: included.length })
    : isService
      ? t('Créer le service')
      : t('Créer le produit');

  return (
    <>
      <Link
        href="/products"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink"
      >
        <Icon name="chevronLeft" className="size-4 rtl:rotate-180" /> {t('Produits & services')}
      </Link>
      <PageHeader
        title={isService ? t('Nouveau service') : t('Nouveau produit')}
        subtitle={t('Renseignez les informations, les prix et le stock de départ.')}
        actions={
          <>
            <Button variant="ghost" onClick={() => router.push('/products')}>
              {t('Annuler')}
            </Button>
            <Button disabled={!canSave} loading={create.isPending} onClick={() => create.mutate(false)} variant="primary">
              <Icon name="check" /> {saveLabel}
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {/* Type */}
          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceCard
              active={!isService}
              icon="box"
              title={t('Produit')}
              text={t('Un article physique, suivi en stock')}
              onClick={() => setIsService(false)}
            />
            <ChoiceCard
              active={isService}
              icon="file"
              title={t('Service')}
              text={t('Une prestation, sans gestion de stock')}
              onClick={() => setIsService(true)}
            />
          </div>

          <Card>
            <CardHeader title={t('Informations générales')} />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label={t('Nom')} required className="sm:col-span-2">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('Ex. Smartphone Galaxy A55')}
                  autoFocus
                />
              </Field>
              <Field label={t('Catégorie')}>
                <FacetPicker kind="categories" value={category} onChange={setCategory} />
              </Field>
              <Field label={t('Marque')}>
                <FacetPicker kind="brands" value={brand} onChange={setBrand} />
              </Field>
              <Field label={t('Référence')} hint={t('Sert de base aux SKU générés')}>
                <Input
                  value={reference}
                  onChange={(event) => setReference(event.target.value.toUpperCase())}
                  className="font-mono"
                />
              </Field>
              <Field label={t('Unité')}>
                <UnitPicker value={unitId} onChange={setUnitId} />
              </Field>
              <Field label={t('Description')} className="sm:col-span-2">
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  placeholder={t('Visible sur les documents et dans la caisse (facultatif)')}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title={t('Photos')} description={t('La première photo est la photo principale')} />
            <div className="p-5">
              <StagedImagePicker files={photos} onChange={setPhotos} />
            </div>
          </Card>

          <Card>
            <CardHeader title={t('Prix et TVA')} description={t('Prix de base, repris par chaque variante sauf modification')} />
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <Field label={t('Prix de vente HT')}>
                <NumberInput value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} />
              </Field>
              <Field label={t('Prix d’achat')}>
                <NumberInput value={costPrice} onChange={(event) => setCostPrice(event.target.value)} />
              </Field>
              <Field label={t('TVA (%)')}>
                <NumberInput value={vatRate} onChange={(event) => setVatRate(event.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-b-card border-t border-border bg-border text-sm">
              <Figure label={t('Marge')} value={money(String(margin))} tone={margin < 0 ? 'bad' : 'good'} />
              <Figure label={t('Taux de marge')} value={`${marginPct.toFixed(1)} %`} tone={margin < 0 ? 'bad' : 'good'} />
              <Figure label={t('Prix TTC')} value={money(priceTtc.toFixed(2))} />
            </div>
          </Card>

          {!isService && (
            <Card>
              <CardHeader title={t('Déclinaisons')} description={t('Taille, couleur, stockage… un produit, plusieurs variantes')} />
              <div className="space-y-4 p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <ChoiceCard
                    active={!hasVariants}
                    icon="tag"
                    title={t('Produit simple')}
                    text={t('Une seule référence')}
                    onClick={() => setHasVariants(false)}
                  />
                  <ChoiceCard
                    active={hasVariants}
                    icon="layout"
                    title={t('Avec variantes')}
                    text={t('Générées à partir des attributs')}
                    onClick={() => setHasVariants(true)}
                  />
                </div>

                {hasVariants && (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('Dimensions')}</p>
                      <Button size="sm" variant="ghost" onClick={() => setAttributeOpen(true)}>
                        <Icon name="plus" /> {t('Nouvel attribut')}
                      </Button>
                    </div>
                    {attributes.data && attributes.data.length === 0 && (
                      <p className="rounded-lg border border-dashed border-border-strong p-4 text-center text-sm text-ink-muted">
                        {t('Aucun attribut. Créez par exemple « Taille » ou « Couleur ».')}
                      </p>
                    )}
                    <div className="space-y-3">
                      {attributes.data?.map((attribute) => (
                        <div key={attribute.id} className="rounded-lg border border-border p-3">
                          <p className="mb-2 text-sm font-medium text-ink">{attribute.name}</p>
                          <div className="flex flex-wrap gap-2">
                            {attribute.values.map((value) => {
                              const chosen = selected[attribute.id]?.includes(value.id) ?? false;
                              return (
                                <button
                                  key={value.id}
                                  type="button"
                                  aria-pressed={chosen}
                                  onClick={() => toggleValue(attribute.id, value.id)}
                                  className={clsx(
                                    'rounded-lg border px-3 py-1.5 text-xs transition',
                                    chosen
                                      ? 'border-brand bg-brand-soft font-medium text-brand'
                                      : 'border-border-strong text-ink-muted hover:bg-surface-muted',
                                  )}
                                >
                                  {value.colorHex && (
                                    <span
                                      className="me-1.5 inline-block size-2 rounded-full align-middle"
                                      style={{ background: value.colorHex }}
                                    />
                                  )}
                                  {value.value}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>

                    {rows.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                          {t('{n} variante(s) seront créées — décochez celles qui n’existent pas', { n: included.length })}
                        </p>
                        <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-border">
                          <Table className="text-xs">
                            <thead className="sticky top-0 z-10 bg-surface">
                              <tr>
                                <Th className="w-8" />
                                <Th>{t('Déclinaison')}</Th>
                                <Th>{t('SKU')}</Th>
                                <Th>{t('Code-barres')}</Th>
                                <Th numeric>{t('Prix de vente')}</Th>
                                <Th numeric>{t('Coût')}</Th>
                                <Th numeric>{t('Stock initial')}</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((row) => (
                                <tr key={row.key} className={clsx(!row.included && 'opacity-45')}>
                                  <Td>
                                    <input
                                      type="checkbox"
                                      checked={row.included}
                                      aria-label={row.combination.label}
                                      onChange={(event) => patchRow(row.key, { excluded: !event.target.checked })}
                                      className="size-3.5 rounded border-border-strong text-brand"
                                    />
                                  </Td>
                                  <Td className="whitespace-nowrap font-medium">{row.combination.label}</Td>
                                  <Td>
                                    <Input
                                      value={row.sku}
                                      disabled={!row.included}
                                      onChange={(event) => patchRow(row.key, { sku: event.target.value.toUpperCase() })}
                                      className="h-8 min-w-32 font-mono text-xs"
                                    />
                                  </Td>
                                  <Td>
                                    <Input
                                      value={row.barcode}
                                      disabled={!row.included}
                                      onChange={(event) => patchRow(row.key, { barcode: event.target.value })}
                                      className="h-8 min-w-32 font-mono text-xs"
                                    />
                                  </Td>
                                  <Td>
                                    <NumberInput
                                      value={row.sellingPrice}
                                      disabled={!row.included}
                                      onChange={(event) => patchRow(row.key, { sellingPrice: event.target.value })}
                                      className="h-8 w-24 text-xs"
                                    />
                                  </Td>
                                  <Td>
                                    <NumberInput
                                      value={row.costPrice}
                                      disabled={!row.included}
                                      onChange={(event) => patchRow(row.key, { costPrice: event.target.value })}
                                      className="h-8 w-24 text-xs"
                                    />
                                  </Td>
                                  <Td>
                                    <NumberInput
                                      value={row.stock}
                                      placeholder="0"
                                      disabled={!row.included}
                                      onChange={(event) => patchRow(row.key, { stock: event.target.value })}
                                      className="h-8 w-20 text-xs"
                                    />
                                  </Td>
                                </tr>
                              ))}
                            </tbody>
                          </Table>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </Card>
          )}

          {!variantMode && (
            <Card>
              <CardHeader
                title={isService ? t('Référence du service') : t('Référence et stock')}
              />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label={t('SKU')} hint={t('Laissez vide pour le générer automatiquement')}>
                  <Input
                    value={simpleSku}
                    onChange={(event) => setSimpleSku(event.target.value.toUpperCase())}
                    placeholder={autoSku(reference, name) || 'PRD'}
                    className="font-mono"
                  />
                </Field>
                <Field label={t('Code-barres')}>
                  <div className="flex gap-2">
                    <Input
                      value={simpleBarcode}
                      onChange={(event) => setSimpleBarcode(event.target.value)}
                      className="font-mono"
                    />
                    <Button onClick={() => setSimpleBarcode(generateEan13())}>{t('Générer')}</Button>
                  </div>
                </Field>
                {!isService && (
                  <>
                    <Field label={t('Stock initial')}>
                      <NumberInput value={simpleStock} placeholder="0" onChange={(event) => setSimpleStock(event.target.value)} />
                    </Field>
                    <Field label={t('Seuil d’alerte')} hint={t('Alerte quand le stock passe sous ce niveau')}>
                      <NumberInput value={threshold} onChange={(event) => setThreshold(event.target.value)} />
                    </Field>
                  </>
                )}
              </div>
            </Card>
          )}

          {!isService && (
            <Card>
              <CardHeader title={t('Entrepôt du stock initial')} />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label={t('Entrepôt')}>
                  <Select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
                    {activeWarehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.code} — {warehouse.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {variantMode && (
                  <Field label={t('Seuil d’alerte')} hint={t('Appliqué à chaque variante')}>
                    <NumberInput value={threshold} onChange={(event) => setThreshold(event.target.value)} />
                  </Field>
                )}
              </div>
            </Card>
          )}
        </div>

        {/* Summary */}
        <aside className="space-y-4 lg:sticky lg:top-20">
          <Card className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('Récapitulatif')}</p>
            <p className="font-display mt-2 truncate text-lg font-semibold text-ink">
              {name.trim() || t('Sans nom')}
            </p>
            <p className="mt-0.5 truncate text-sm text-ink-muted">
              {[category, brand].filter(Boolean).join(' · ') || t('Sans catégorie')}
            </p>
            <dl className="mt-4 space-y-2.5 text-sm">
              <Line label={t('Type')} value={isService ? t('Service') : variantMode ? t('Avec variantes') : t('Produit simple')} />
              <Line label={t('Variantes')} value={String(variantMode ? included.length : 1)} />
              <Line label={t('Photos')} value={String(photos.length)} />
              <Line label={t('Prix de vente HT')} value={money(String(selling))} />
              <Line label={t('Prix TTC')} value={money(priceTtc.toFixed(2))} />
              <Line label={t('Marge')} value={`${marginPct.toFixed(1)} %`} />
            </dl>
            {needsDimensions && (
              <p className="mt-4 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                {t('Choisissez au moins une valeur d’attribut pour générer les variantes.')}
              </p>
            )}
            <div className="mt-5 space-y-2">
              <Button
                variant="primary"
                className="w-full"
                disabled={!canSave}
                loading={create.isPending}
                onClick={() => create.mutate(false)}
              >
                <Icon name="check" /> {saveLabel}
              </Button>
              <Button className="w-full" disabled={!canSave || create.isPending} onClick={() => create.mutate(true)}>
                {t('Créer et en ajouter un autre')}
              </Button>
            </div>
          </Card>
        </aside>
      </div>

      {attributeOpen && <AttributeTypeDialog onClose={() => setAttributeOpen(false)} />}
    </>
  );
}

function ChoiceCard({
  active,
  icon,
  title,
  text,
  onClick,
}: {
  active: boolean;
  icon: 'box' | 'file' | 'tag' | 'layout';
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'flex items-center gap-3 rounded-card border p-4 text-start transition',
        active
          ? 'border-brand bg-brand-soft shadow-sm'
          : 'border-border bg-surface hover:border-border-strong hover:bg-surface-muted',
      )}
    >
      <span
        className={clsx(
          'flex size-10 shrink-0 items-center justify-center rounded-lg',
          active ? 'bg-brand text-white dark:text-canvas' : 'bg-surface-muted text-ink-muted',
        )}
      >
        <Icon name={icon} className="size-5" />
      </span>
      <span className="min-w-0">
        <span className={clsx('block text-sm font-semibold', active ? 'text-brand' : 'text-ink')}>{title}</span>
        <span className="block text-xs text-ink-muted">{text}</span>
      </span>
    </button>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="bg-surface px-5 py-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={clsx('mt-0.5 font-semibold tabular-nums', tone === 'bad' ? 'text-danger' : 'text-ink')}>{value}</p>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="truncate font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}
