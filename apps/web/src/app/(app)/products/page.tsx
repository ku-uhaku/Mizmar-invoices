'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import { AttributeTypeDialog } from '@/components/attribute-type-dialog';
import { FacetPicker, UnitPicker } from '@/components/catalog-pickers';
import { ImportDialog } from '@/components/import-dialog';
import { ProductImageManager, StagedImagePicker, Thumb } from '@/components/product-images';
import { uploadProductImages, type GalleryImage } from '@/lib/product-images';
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
  LinkButton,
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
  unitId: string | null;
  description: string | null;
  defaultVatRate: string;
  isActive: boolean;
  images: GalleryImage[];
  imageUrls: string[];
}

function CatalogScreen() {
  const t = useT();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [debounced, setDebounced] = useState(search);
  const [lowStockOnly, setLowStockOnly] = useState(false);
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
        title={t('Produits & services')}
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
            <LinkButton variant="primary" href="/products/new">
              <Icon name="plus" /> {t('Nouveau produit')}
            </LinkButton>
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
                      <span className="flex items-center gap-3">
                        <Thumb url={product.imageUrls[0]} />
                        <span>
                          <span className="font-semibold text-ink">{product.name}</span>
                          <div className="text-xs text-ink-muted">
                            {product.reference ?? '—'}
                            {product.brand ? ` · ${product.brand}` : ''}
                          </div>
                        </span>
                      </span>
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
              <LinkButton variant="primary" href="/products/new">
                <Icon name="plus" /> {t('Nouveau produit')}
              </LinkButton>
            }
          />
        )}
      </Card>

      <ImportDialog kind="products" open={importOpen} onClose={() => setImportOpen(false)} />
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

/** Product-level fields only: variants are edited through their own flows. */
function EditProductDialog({ product, onClose }: { product: ProductRow; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState(product.name);
  const [reference, setReference] = useState(product.reference ?? '');
  const [category, setCategory] = useState(product.category ?? '');
  const [brand, setBrand] = useState(product.brand ?? '');
  const [unitId, setUnitId] = useState(product.unitId ?? '');
  const [description, setDescription] = useState(product.description ?? '');
  const [vatRate, setVatRate] = useState(String(Number(product.defaultVatRate)));
  const [isActive, setIsActive] = useState(product.isActive);
  const [images, setImages] = useState<GalleryImage[]>(product.images);
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
            ...(unitId ? { unitId } : {}),
            description: description.trim(),
            defaultVatRate: vatRate,
            isActive,
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['product-facets'] });
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
        <ProductImageManager
          productId={product.id}
          images={images}
          onChange={(next) => {
            setImages(next);
            void queryClient.invalidateQueries({ queryKey: ['products'] });
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Nom')} required>
            <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          <Field label={t('Référence')}>
            <Input value={reference} onChange={(event) => setReference(event.target.value)} />
          </Field>
          <Field label={t('Catégorie')}>
            <FacetPicker kind="categories" value={category} onChange={setCategory} />
          </Field>
          <Field label={t('Marque')}>
            <FacetPicker kind="brands" value={brand} onChange={setBrand} />
          </Field>
          <Field label={t('Unité')}>
            <UnitPicker value={unitId} onChange={setUnitId} />
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
