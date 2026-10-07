'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import { ImportDialog } from '@/components/import-dialog';
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
  SearchInput,
  Table,
  Td,
  Th,
  Toggle,
  TableSkeleton,
  toast,
} from '@/components/ui';
import { money, percent, qty } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

interface ProductRow {
  id: string;
  name: string;
  reference: string | null;
  category: string | null;
  brand: string | null;
  description: string | null;
  defaultVatRate: string;
  isActive: boolean;
}

function CatalogScreen() {
  const t = useT();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [debounced, setDebounced] = useState(search);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [attributeOpen, setAttributeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [deleting, setDeleting] = useState<ProductRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const products = useQuery({
    queryKey: ['products', { search: debounced, lowStockOnly }],
    queryFn: async () =>
      unwrap(
        await api.catalog.listProducts({
          query: {
            limit: 100,
            ...(debounced ? { search: debounced } : {}),
            ...(lowStockOnly ? { lowStockOnly: true } : {}),
          },
        }),
      ),
  });

  const hasFilters = Boolean(debounced || lowStockOnly);
  const count = products.data?.items.length;
  const resetFilters = () => {
    setSearch('');
    setLowStockOnly(false);
  };

  return (
    <>
      <PageHeader
        title={t('Catalogue')}
        subtitle={
          count === undefined
            ? t('Produits et variantes')
            : count === 0
              ? t('Aucun produit')
              : hasFilters
                ? t('{n} produit(s) correspondant aux filtres', { n: count })
                : t('{n} produit(s)', { n: count })
        }
        actions={
          <>
            <Button onClick={() => setImportOpen(true)}>
              <Icon name="download" className="rotate-180" /> {t('Importer')}
            </Button>
            <Button onClick={() => setAttributeOpen(true)}>
              <Icon name="plus" /> {t('Nouvel attribut')}
            </Button>
            <Button variant="primary" onClick={() => setNewOpen(true)}>
              <Icon name="plus" /> {t('Nouveau produit')}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput
          className="w-full sm:w-80"
          placeholder={t('Nom, référence, SKU, code-barres…')}
          aria-label={t('Rechercher un produit')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Toggle active={lowStockOnly} onClick={() => setLowStockOnly((value) => !value)}>
          <Icon name="alert" /> {t('Stock bas')}
        </Toggle>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <Icon name="x" /> {t('Réinitialiser')}
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {products.isPending ? (
          <TableSkeleton rows={6} cols={5} />
        ) : products.data && products.data.items.length > 0 ? (
          <Table className="min-w-[680px]">
            <thead>
              <tr>
                <Th className="w-10" />
                <Th>{t('Produit')}</Th>
                <Th>{t('Catégorie')}</Th>
                <Th numeric>{t('Variantes')}</Th>
                <Th numeric>{t('Stock total')}</Th>
                <Th numeric>{t('TVA')}</Th>
                <Th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {products.data.items.flatMap((product) => {
                const isOpen = expanded === product.id;
                const toggle = () => setExpanded(isOpen ? null : product.id);
                const rows = [
                  <tr
                    key={product.id}
                    onClick={toggle}
                    className={clsx('cursor-pointer hover:bg-surface-muted/60', isOpen && 'bg-surface-muted/40')}
                  >
                    <Td className="pe-0">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={isOpen ? t('Masquer les variantes') : t('Afficher les variantes')}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggle();
                        }}
                        className="flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink"
                      >
                        <Icon
                          name="chevronRight"
                          className={clsx('size-4 transition-transform rtl:-scale-x-100', isOpen && 'rotate-90 rtl:rotate-90')}
                        />
                      </button>
                    </Td>
                    <Td>
                      <span className="font-semibold text-ink">{product.name}</span>
                      <div className="text-xs text-ink-muted">
                        {product.reference ?? '—'}
                        {product.brand ? ` · ${product.brand}` : ''}
                      </div>
                    </Td>
                    <Td className="text-ink-muted">{product.category ?? '—'}</Td>
                    <Td numeric>{product.variants.length}</Td>
                    <Td numeric>
                      {product.isService ? (
                        <Badge>{t('Service')}</Badge>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-2">
                          {(product.lowStockVariantCount ?? 0) > 0 && (
                            <Badge tone="progress">
                              {t('{n} sous le seuil', { n: product.lowStockVariantCount ?? 0 })}
                            </Badge>
                          )}
                          <span className="font-semibold">{qty(product.totalOnHand)}</span>
                        </span>
                      )}
                    </Td>
                    <Td numeric className="text-ink-muted">{percent(product.defaultVatRate)}</Td>
                    <Td>
                      <div className="flex justify-end gap-0.5" onClick={(event) => event.stopPropagation()}>
                        <IconButton label={t('Modifier')} onClick={() => setEditing(product)}>
                          <Icon name="file" />
                        </IconButton>
                        <IconButton
                          label={t('Supprimer')}
                          onClick={() => setDeleting(product)}
                          className="hover:bg-danger-soft hover:text-danger"
                        >
                          <Icon name="x" />
                        </IconButton>
                      </div>
                    </Td>
                  </tr>,
                ];

                if (isOpen) {
                  rows.push(
                    <tr key={`${product.id}-variants`}>
                      <Td colSpan={7} className="bg-surface-muted/40 p-0">
                        <Table className="min-w-[720px] text-xs">
                          <thead>
                            <tr>
                              <Th>{t('SKU')}</Th>
                              <Th>{t('Déclinaison')}</Th>
                              <Th>{t('Code-barres')}</Th>
                              <Th numeric>{t('Prix de vente')}</Th>
                              <Th numeric>{t('Coût')}</Th>
                              <Th numeric>{t('Seuil')}</Th>
                              <Th>{t('État')}</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {product.variants.map((variant) => (
                              <tr key={variant.id}>
                                <Td className="font-semibold">{variant.sku}</Td>
                                <Td>
                                  {variant.attributes.length > 0 ? (
                                    <span className="flex flex-wrap gap-1">
                                      {variant.attributes.map((attribute) => (
                                        <Badge key={attribute.attributeValueId}>
                                          {attribute.colorHex && (
                                            <span
                                              className="me-1 inline-block size-2 rounded-full"
                                              style={{ background: attribute.colorHex }}
                                            />
                                          )}
                                          {attribute.value}
                                        </Badge>
                                      ))}
                                    </span>
                                  ) : (
                                    <span className="text-ink-subtle">—</span>
                                  )}
                                </Td>
                                <Td className="text-ink-muted">{variant.barcode ?? '—'}</Td>
                                <Td numeric>
                                  {variant.sellingPrice ? money(variant.sellingPrice) : '—'}
                                </Td>
                                <Td numeric className="text-ink-muted">
                                  {variant.costPrice ? money(variant.costPrice) : '—'}
                                </Td>
                                <Td numeric className="text-ink-subtle">
                                  {qty(variant.minStockThreshold)}
                                </Td>
                                <Td>
                                  <Badge tone={variant.isActive ? 'success' : 'neutral'}>
                                    {variant.isActive ? t('Actif') : t('Inactif')}
                                  </Badge>
                                </Td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      </Td>
                    </tr>,
                  );
                }

                return rows;
              })}
            </tbody>
          </Table>
        ) : hasFilters ? (
          <EmptyState
            icon="search"
            title={t('Aucun résultat')}
            description={t('Aucun produit ne correspond à ces filtres. Essayez d’en retirer un.')}
            action={<Button onClick={resetFilters}>{t('Réinitialiser les filtres')}</Button>}
          />
        ) : (
          <EmptyState
            icon="tag"
            title={t('Aucun produit pour l’instant')}
            description={t('Créez votre premier produit : ses variantes et son stock apparaîtront ici.')}
            action={
              <Button variant="primary" onClick={() => setNewOpen(true)}>
                <Icon name="plus" /> {t('Nouveau produit')}
              </Button>
            }
          />
        )}
      </Card>

      <ImportDialog kind="products" open={importOpen} onClose={() => setImportOpen(false)} />
      <NewProductDialog open={newOpen} onClose={() => setNewOpen(false)} />
      {attributeOpen && <AttributeTypeDialog onClose={() => setAttributeOpen(false)} />}
      {editing && (
        <EditProductDialog key={editing.id} product={editing} onClose={() => setEditing(null)} />
      )}
      {deleting && <DeleteProductDialog product={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

export default function CatalogPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <CatalogScreen />
    </Suspense>
  );
}

/**
 * Create a product by generating the cross-product of its attributes.
 *
 * The matrix is previewed server-side first, so the user deselects the
 * combinations that do not exist (there is no XXL in that colour) before
 * anything is written.
 */
function NewProductDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [category, setCategory] = useState('');
  const [vatRate, setVatRate] = useState('20');
  const [sellingPrice, setSellingPrice] = useState('0');
  const [costPrice, setCostPrice] = useState('0');
  const [threshold, setThreshold] = useState('0');
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const attributes = useQuery({
    queryKey: ['attribute-types'],
    queryFn: async () => unwrap(await api.catalog.listAttributeTypes()),
    enabled: open,
  });

  const dimensions = Object.entries(selected)
    .filter(([, values]) => values.length > 0)
    .map(([attributeTypeId, attributeValueIds]) => ({ attributeTypeId, attributeValueIds }));

  const matrix = useQuery({
    queryKey: ['variant-matrix', dimensions, reference, sellingPrice, costPrice, threshold],
    queryFn: async () =>
      unwrap(
        await api.catalog.variantMatrix({
          body: {
            skuPrefix: reference || name.slice(0, 6),
            dimensions,
            defaults: { sellingPrice, costPrice, minStockThreshold: threshold },
          },
        }),
      ),
    enabled: open && dimensions.length > 0,
  });

  const combinations = (matrix.data?.combinations ?? []).filter(
    (combination) => !excluded.has(combination.suggestedSku),
  );

  const create = useMutation({
    mutationFn: async () => {
      setError(null);
      const variants =
        combinations.length > 0
          ? combinations.map((combination) => ({
              sku: combination.suggestedSku,
              attributeValueIds: combination.attributeValueIds,
              sellingPrice,
              costPrice,
              minStockThreshold: threshold,
              isActive: true,
            }))
          : // A simple product still gets exactly one variant, so stock and
            // document lines have a single uniform shape.
            [
              {
                sku: reference || name.toUpperCase().replace(/\s+/g, '-').slice(0, 24),
                attributeValueIds: [],
                sellingPrice,
                costPrice,
                minStockThreshold: threshold,
                isActive: true,
              },
            ];

      return unwrap(
        await api.catalog.createProduct({
          body: {
            name,
            reference: reference || undefined,
            category: category || undefined,
            defaultVatRate: vatRate,
            isVariantManaged: combinations.length > 0,
            isService: false,
            attributeTypeIds: dimensions.map((dimension) => dimension.attributeTypeId),
            variants,
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(t('Produit créé'));
      setName('');
      setReference('');
      setSelected({});
      setExcluded(new Set());
      onClose();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Création impossible')),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title={t('Nouveau produit')}
      description={t('Choisissez les dimensions pour générer les variantes automatiquement.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!name.trim()}
            onClick={() => create.mutate()}
          >
            {combinations.length > 0 ? t('Créer {n} variante(s)', { n: combinations.length }) : t('Créer le produit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNote>{error}</ErrorNote>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Nom')} required>
            <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          <Field label={t('Référence / préfixe SKU')}>
            <Input
              value={reference}
              onChange={(event) => setReference(event.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t('Catégorie')}>
            <Input value={category} onChange={(event) => setCategory(event.target.value)} />
          </Field>
          <Field label={t('TVA (%)')}>
            <NumberInput value={vatRate} onChange={(event) => setVatRate(event.target.value)} />
          </Field>
          <Field label={t('Prix de vente HT')}>
            <NumberInput
              value={sellingPrice}
              onChange={(event) => setSellingPrice(event.target.value)}
            />
          </Field>
          <Field label={t('Prix d’achat')}>
            <NumberInput value={costPrice} onChange={(event) => setCostPrice(event.target.value)} />
          </Field>
          <Field label={t('Seuil d’alerte')}>
            <NumberInput value={threshold} onChange={(event) => setThreshold(event.target.value)} />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {t('Dimensions')}
          </p>
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
                        onClick={() =>
                          setSelected((current) => {
                            const existing = current[attribute.id] ?? [];
                            return {
                              ...current,
                              [attribute.id]: chosen
                                ? existing.filter((id) => id !== value.id)
                                : [...existing, value.id],
                            };
                          })
                        }
                        className={
                          chosen
                            ? 'rounded-lg border border-brand bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand'
                            : 'rounded-lg border border-border-strong px-3 py-1.5 text-xs text-ink-muted hover:bg-surface-muted'
                        }
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
        </div>

        {matrix.data && matrix.data.combinations.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t('{n} variante(s) seront créées — décochez celles qui n’existent pas', { n: combinations.length })}
            </p>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
              <Table className="text-xs">
                <thead>
                  <tr>
                    <Th className="w-8" />
                    <Th>{t('SKU')}</Th>
                    <Th>{t('Déclinaison')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.data.combinations.map((combination) => (
                    <tr key={combination.suggestedSku}>
                      <Td>
                        <input
                          type="checkbox"
                          checked={!excluded.has(combination.suggestedSku)}
                          onChange={(event) =>
                            setExcluded((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.delete(combination.suggestedSku);
                              else next.add(combination.suggestedSku);
                              return next;
                            })
                          }
                          className="size-3.5 rounded border-border-strong text-brand"
                        />
                      </Td>
                      <Td className="font-medium">{combination.suggestedSku}</Td>
                      <Td className="text-ink-muted">{combination.label}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** Product-level fields only: variants are edited through their own flows. */
function EditProductDialog({ product, onClose }: { product: ProductRow; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState(product.name);
  const [reference, setReference] = useState(product.reference ?? '');
  const [category, setCategory] = useState(product.category ?? '');
  const [brand, setBrand] = useState(product.brand ?? '');
  const [description, setDescription] = useState(product.description ?? '');
  const [vatRate, setVatRate] = useState(String(Number(product.defaultVatRate)));
  const [isActive, setIsActive] = useState(product.isActive);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await api.catalog.updateProduct({
          params: { id: product.id },
          body: {
            name: name.trim(),
            reference: reference.trim(),
            category: category.trim(),
            brand: brand.trim(),
            description: description.trim(),
            defaultVatRate: vatRate,
            isActive,
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(t('Produit mis à jour'));
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('Modifier le produit')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!name.trim()}
            onClick={() => save.mutate()}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNote>{error}</ErrorNote>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Nom')} required>
            <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          <Field label={t('Référence')}>
            <Input value={reference} onChange={(event) => setReference(event.target.value)} />
          </Field>
          <Field label={t('Catégorie')}>
            <Input value={category} onChange={(event) => setCategory(event.target.value)} />
          </Field>
          <Field label={t('Marque')}>
            <Input value={brand} onChange={(event) => setBrand(event.target.value)} />
          </Field>
          <Field label={t('TVA (%)')}>
            <NumberInput value={vatRate} onChange={(event) => setVatRate(event.target.value)} />
          </Field>
        </div>
        <Field label={t('Description')}>
          <Input value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Checkbox
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          label={t('Produit actif')}
        />
      </div>
    </Dialog>
  );
}

function DeleteProductDialog({ product, onClose }: { product: ProductRow; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.catalog.removeProduct({ params: { id: product.id } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(t('Produit supprimé'));
      onClose();
    },
    onError: (cause) => {
      toast.error(cause instanceof ApiError ? cause.message : t('Suppression impossible'));
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('Supprimer ce produit ?')}
      description={t('« {name} » sera supprimé. S’il apparaît dans des documents ou des mouvements de stock, il sera seulement désactivé.', { name: product.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            Supprimer
          </Button>
        </>
      }
    >
      <></>
    </Dialog>
  );
}

/** Create a dimension (size, colour…) together with its values. */
function AttributeTypeDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [values, setValues] = useState<Array<{ value: string; colorHex: string }>>([
    { value: '', colorHex: '' },
  ]);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      setError(null);
      const filled = values.filter((entry) => entry.value.trim());
      return unwrap(
        await api.catalog.createAttributeType({
          body: {
            code: code.trim().toUpperCase(),
            name: name.trim(),
            sortOrder: 0,
            values: filled.map((entry, index) => ({
              value: entry.value.trim(),
              sortOrder: index,
              ...(/^#[0-9a-fA-F]{6}$/.test(entry.colorHex) ? { colorHex: entry.colorHex } : {}),
            })),
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attribute-types'] });
      toast.success(t('Attribut créé'));
      onClose();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Création impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('Nouvel attribut')}
      description={t('Une dimension de variante, par exemple la taille ou la couleur.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!code.trim() || !name.trim()}
            onClick={() => create.mutate()}
          >
            {t('Créer')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNote>{error}</ErrorNote>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Nom')} required>
            <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          <Field label={t('Code')} required>
            <Input
              value={code}
              maxLength={40}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('Valeurs')}</p>
          <div className="space-y-2">
            {values.map((entry, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-label={t('Valeur')}
                  value={entry.value}
                  onChange={(event) =>
                    setValues((current) =>
                      current.map((v, i) => (i === index ? { ...v, value: event.target.value } : v)),
                    )
                  }
                />
                <input
                  type="color"
                  aria-label={t('Couleur')}
                  value={/^#[0-9a-fA-F]{6}$/.test(entry.colorHex) ? entry.colorHex : '#ffffff'}
                  onChange={(event) =>
                    setValues((current) =>
                      current.map((v, i) => (i === index ? { ...v, colorHex: event.target.value } : v)),
                    )
                  }
                  className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-border-strong bg-surface p-1"
                />
                <IconButton
                  label={t('Retirer')}
                  onClick={() => setValues((current) => current.filter((_, i) => i !== index))}
                  className="hover:bg-danger-soft hover:text-danger"
                >
                  <Icon name="x" />
                </IconButton>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => setValues((current) => [...current, { value: '', colorHex: '' }])}
          >
            <Icon name="plus" /> {t('Ajouter une valeur')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
