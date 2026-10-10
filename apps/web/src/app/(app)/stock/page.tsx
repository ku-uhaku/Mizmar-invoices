'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import { AdjustDialog } from '@/components/dialogs/adjust-dialog';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
  type BadgeTone,
} from '@/components/ui';
import { dateTime, money, MOVEMENT_TYPE_LABELS, qty } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

type Filter = 'all' | 'low' | 'zero' | 'negative';

function stockStatus(row: {
  onHand: string;
  available: string;
  isLowStock?: boolean;
}): { tone: BadgeTone; label: string } {
  if (Number(row.onHand) < 0) return { tone: 'danger', label: 'Négatif' };
  if (Number(row.available) <= 0) return { tone: 'danger', label: 'Rupture' };
  if (row.isLowStock) return { tone: 'progress', label: 'Sous le seuil' };
  return { tone: 'success', label: 'En stock' };
}

function StockScreen() {
  const t = useT();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [tab, setTab] = useState<'levels' | 'movements'>('levels');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => unwrap(await api.inventory.listWarehouses()),
  });

  const stock = useQuery({
    queryKey: ['stock', { search: debounced, warehouseId, filter }],
    queryFn: async () =>
      unwrap(
        await api.inventory.stock({
          query: {
            limit: 100,
            filter,
            ...(debounced ? { search: debounced } : {}),
            ...(warehouseId ? { warehouseId } : {}),
          },
        }),
      ),
    enabled: tab === 'levels',
  });

  const movements = useQuery({
    queryKey: ['movements', { warehouseId }],
    queryFn: async () =>
      unwrap(
        await api.inventory.movements({
          query: { limit: 100, ...(warehouseId ? { warehouseId } : {}) },
        }),
      ),
    enabled: tab === 'movements',
  });

  const hasFilters = Boolean(debounced || warehouseId || filter !== 'all');
  const resetFilters = () => {
    setSearch('');
    setWarehouseId('');
    setFilter('all');
  };

  return (
    <>
      <PageHeader
        title={t('Stock')}
        subtitle={t('Quantités par variante et par dépôt')}
        actions={
          <Button variant="primary" onClick={() => setAdjustOpen(true)}>
            <Icon name="plus" /> {t('Ajuster le stock')}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'levels', label: t('Niveaux') },
            { value: 'movements', label: t('Mouvements') },
          ]}
        />
        {tab === 'levels' && (
          <SearchInput
            className="w-full sm:w-80"
            placeholder={t('Référence, code-barres, nom, couleur…')}
            aria-label={t('Rechercher un article')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
        <div className="w-full sm:w-56">
          <Select
            aria-label={t('Dépôt')}
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
          >
            <option value="">{t('Tous les dépôts')}</option>
            {warehouses.data?.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} — {warehouse.name}
              </option>
            ))}
          </Select>
        </div>
        {tab === 'levels' && (
          <div className="w-full sm:w-48">
            <Select
              aria-label={t('Filtre de stock')}
              value={filter}
              onChange={(event) => setFilter(event.target.value as Filter)}
            >
              <option value="all">{t('Tout le stock')}</option>
              <option value="low">{t('Sous le seuil')}</option>
              <option value="zero">{t('Stock nul')}</option>
              <option value="negative">{t('Stock négatif')}</option>
            </Select>
          </div>
        )}
        {hasFilters && (tab === 'levels' || warehouseId) && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <Icon name="x" /> {t('Réinitialiser')}
          </Button>
        )}
      </div>

      {tab === 'levels' ? (
        <Card className="overflow-hidden">
          <CardHeader title={t('Niveaux de stock')} description={t('Disponible = en stock − réservé')} />
          {stock.isPending ? (
            <TableSkeleton rows={6} cols={7} />
          ) : stock.data && stock.data.items.length > 0 ? (
            <Table className="min-w-[920px]">
              <thead>
                <tr>
                  <Th>{t('Article')}</Th>
                  <Th>{t('Dépôt')}</Th>
                  <Th>{t('État')}</Th>
                  <Th numeric>{t('En stock')}</Th>
                  <Th numeric>{t('Réservé')}</Th>
                  <Th numeric>{t('Disponible')}</Th>
                  <Th numeric>{t('Attendu')}</Th>
                  <Th numeric>{t('Seuil')}</Th>
                  <Th numeric>{t('Valeur')}</Th>
                </tr>
              </thead>
              <tbody>
                {stock.data.items.map((row) => {
                  const status = stockStatus(row);
                  return (
                    <tr
                      key={`${row.variantId}-${row.warehouseId}`}
                      onClick={() => router.push(`/catalog?search=${encodeURIComponent(row.sku)}`)}
                      className="cursor-pointer hover:bg-surface-muted/60"
                    >
                      <Td>
                        <Link
                          href={`/catalog?search=${encodeURIComponent(row.sku)}`}
                          onClick={(event) => event.stopPropagation()}
                          className="font-semibold text-ink hover:text-brand"
                        >
                          {row.productName}
                        </Link>
                        <div className="text-xs text-ink-muted">
                          {row.sku}
                          {row.variantLabel ? ` · ${row.variantLabel}` : ''}
                        </div>
                      </Td>
                      <Td className="text-ink-muted">{row.warehouseCode}</Td>
                      <Td>
                        <Badge tone={status.tone}>{t(status.label)}</Badge>
                      </Td>
                      <Td numeric className={Number(row.onHand) < 0 ? 'font-semibold text-danger' : ''}>
                        {qty(row.onHand)}
                      </Td>
                      <Td numeric className="text-ink-muted">{qty(row.reserved)}</Td>
                      <Td numeric className="font-semibold">{qty(row.available)}</Td>
                      <Td numeric className="text-ink-muted">{qty(row.incoming)}</Td>
                      <Td numeric className="text-ink-subtle">{qty(row.minStockThreshold)}</Td>
                      <Td numeric className="text-ink-muted">
                        {row.stockValue ? money(row.stockValue) : '—'}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : hasFilters ? (
            <EmptyState
              icon="search"
              title={t('Aucun résultat')}
              description={t('Aucune ligne de stock ne correspond à ces filtres. Essayez d’en retirer un.')}
              action={<Button onClick={resetFilters}>{t('Réinitialiser les filtres')}</Button>}
            />
          ) : (
            <EmptyState
              icon="warehouse"
              title={t('Aucun stock pour l’instant')}
              description={t('Les quantités apparaissent ici dès qu’un article est ajusté ou réceptionné.')}
              action={
                <Button variant="primary" onClick={() => setAdjustOpen(true)}>
                  <Icon name="plus" /> {t('Ajuster le stock')}
                </Button>
              }
            />
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader
            title={t('Journal des mouvements')}
            description={t('Chaque mouvement, son document, son motif et son auteur')}
          />
          {movements.isPending ? (
            <TableSkeleton rows={6} cols={7} />
          ) : movements.data && movements.data.items.length > 0 ? (
            <Table className="min-w-[920px]">
              <thead>
                <tr>
                  <Th>{t('Date')}</Th>
                  <Th>{t('Article')}</Th>
                  <Th>{t('Dépôt')}</Th>
                  <Th>{t('Type')}</Th>
                  <Th numeric>{t('Quantité')}</Th>
                  <Th numeric>{t('Solde après')}</Th>
                  <Th>{t('Document')}</Th>
                  <Th>{t('Utilisateur')}</Th>
                </tr>
              </thead>
              <tbody>
                {movements.data.items.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-muted/60">
                    <Td className="whitespace-nowrap text-ink-muted">{dateTime(row.createdAt)}</Td>
                    <Td>
                      <span className="font-semibold">{row.sku}</span>
                      <div className="text-xs text-ink-muted">
                        {row.productName}
                        {row.variantLabel ? ` · ${row.variantLabel}` : ''}
                      </div>
                    </Td>
                    <Td className="text-ink-muted">{row.warehouseCode}</Td>
                    <Td>
                      <Badge tone={row.direction === 'IN' ? 'success' : 'neutral'}>
                        {t(MOVEMENT_TYPE_LABELS[row.type] ?? row.type)}
                      </Badge>
                    </Td>
                    <Td
                      numeric
                      className={row.direction === 'OUT' ? 'font-medium text-danger' : 'font-medium text-positive'}
                    >
                      {row.direction === 'OUT' ? '−' : '+'}
                      {qty(row.quantity).replace(/^[-−]/, '')}
                    </Td>
                    <Td numeric className="font-semibold">{qty(row.balanceAfter)}</Td>
                    <Td>
                      {row.documentId ? (
                        <Link href={`/documents/${row.documentId}`} className="font-medium text-brand hover:underline">
                          {row.documentNumber}
                        </Link>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </Td>
                    <Td className="text-ink-muted">{row.userName ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState
              icon="clock"
              title={warehouseId ? t('Aucun mouvement dans ce dépôt') : t('Aucun mouvement pour l’instant')}
              description={t('Les entrées, sorties et ajustements seront listés ici.')}
              action={
                warehouseId ? <Button onClick={() => setWarehouseId('')}>Tous les dépôts</Button> : undefined
              }
            />
          )}
        </Card>
      )}

      <AdjustDialog
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        defaultWarehouseId={warehouseId || undefined}
      />
    </>
  );
}

export default function StockPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <StockScreen />
    </Suspense>
  );
}
