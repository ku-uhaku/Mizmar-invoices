'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import type { PriceListDetail, PriceListItem } from '@mizmar/contracts';
import { Combobox } from '@/components/combobox';
import { Icon } from '@/components/icons';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
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
import { VariantPicker } from '@/components/variant-picker';
import { api, ApiError, unwrap } from '@/lib/api';
import { qty } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

const errorMessage = (cause: unknown, fallback: string) =>
  cause instanceof ApiError ? cause.message : fallback;

export default function PriceListsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newCurrency, setNewCurrency] = useState('MAD');

  const lists = useQuery({
    queryKey: ['price-lists'],
    queryFn: async () => unwrap(await api.pricing.listPriceLists()),
  });

  useEffect(() => {
    if (!selectedId && lists.data?.[0]) setSelectedId(lists.data[0].id);
  }, [lists.data, selectedId]);

  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.pricing.createPriceList({
          body: { name: newName.trim(), currency: newCurrency.trim().toUpperCase() || 'MAD', isActive: true },
        }),
      ),
    onSuccess: (created) => {
      setNewName('');
      setSelectedId(created.id);
      void queryClient.invalidateQueries({ queryKey: ['price-lists'] });
      toast.success(t('Liste de prix créée'));
    },
    onError: (cause) => toast.error(errorMessage(cause, t('Création impossible'))),
  });

  return (
    <>
      <PageHeader
        title={t('Listes de prix')}
        subtitle={t('Tarifs par client, par quantité et par devise. Ordre : liste du client, liste par défaut, prix de base.')}
      />
      <div className="grid gap-4 xl:grid-cols-[18rem_1fr]">
        <Card className="self-start">
          <CardHeader title={t('Listes')} />
          <div className="space-y-3 p-3">
            {lists.isLoading ? (
              <TableSkeleton rows={3} cols={1} />
            ) : (
              <ul className="space-y-1">
                {(lists.data ?? []).map((list) => (
                  <li key={list.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(list.id)}
                      className={clsx(
                        'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm transition',
                        list.id === selectedId ? 'bg-brand-soft text-brand' : 'hover:bg-surface-muted',
                      )}
                    >
                      <span className="min-w-0 truncate font-medium">{list.name}</span>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
                        {list.isDefault && <Badge tone="info">{t('Par défaut')}</Badge>}
                        {list.currency}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="space-y-2 border-t border-border pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (newName.trim()) create.mutate();
              }}
            >
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={t('Nom de la nouvelle liste')}
                aria-label={t('Nom de la nouvelle liste')}
              />
              <div className="flex gap-2">
                <Input
                  value={newCurrency}
                  maxLength={3}
                  dir="ltr"
                  className="w-20"
                  aria-label={t('Devise')}
                  onChange={(event) => setNewCurrency(event.target.value.toUpperCase())}
                />
                <Button type="submit" variant="primary" loading={create.isPending} disabled={!newName.trim()}>
                  <Icon name="plus" />
                  {t('Créer')}
                </Button>
              </div>
            </form>
          </div>
        </Card>

        {selectedId ? (
          <ListEditor key={selectedId} id={selectedId} onDeleted={() => setSelectedId(null)} />
        ) : (
          <Card>
            <EmptyState
              icon="tag"
              title={t('Aucune liste de prix')}
              description={t('Créez une liste pour proposer des tarifs spécifiques à certains clients.')}
            />
          </Card>
        )}
      </div>
    </>
  );
}

function ListEditor({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['price-list', id],
    queryFn: async () => unwrap(await api.pricing.getPriceList({ params: { id } })),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['price-list', id] });
    void queryClient.invalidateQueries({ queryKey: ['price-lists'] });
  };
  const onError = (cause: unknown) => setError(errorMessage(cause, t('Action impossible')));

  const patch = useMutation({
    mutationFn: async (body: Parameters<typeof api.pricing.updatePriceList>[0]['body']) =>
      unwrap(await api.pricing.updatePriceList({ params: { id }, body })),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError,
  });

  const setDefault = useMutation({
    mutationFn: async (priceListId: string | null) =>
      unwrap(await api.pricing.setDefaultPriceList({ body: { priceListId } })),
    onSuccess: refresh,
    onError,
  });

  const remove = useMutation({
    mutationFn: async () => unwrap(await api.pricing.removePriceList({ params: { id } })),
    onSuccess: () => {
      refresh();
      onDeleted();
    },
    onError,
  });

  const addItem = useMutation({
    mutationFn: async (body: { variantId: string; price: string; minQuantity: string }) =>
      unwrap(await api.pricing.upsertPriceListItem({ params: { id }, body })),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError,
  });

  const updateItem = useMutation({
    mutationFn: async (vars: { itemId: string; body: Parameters<typeof api.pricing.updatePriceListItem>[0]['body'] }) =>
      unwrap(await api.pricing.updatePriceListItem({ params: { id: vars.itemId }, body: vars.body })),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError,
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => unwrap(await api.pricing.removePriceListItem({ params: { id: itemId } })),
    onSuccess: refresh,
    onError,
  });

  const assign = useMutation({
    mutationFn: async (body: { contactIds: string[]; replace: boolean }) =>
      unwrap(await api.pricing.assignContacts({ params: { id }, body })),
    onSuccess: refresh,
    onError,
  });

  const list = detail.data;
  if (!list) {
    return (
      <Card>
        <TableSkeleton rows={6} cols={5} />
      </Card>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Card>
        <CardHeader
          title={list.name}
          actions={
            <>
              <Button
                size="sm"
                onClick={() => setDefault.mutate(list.isDefault ? null : list.id)}
                loading={setDefault.isPending}
              >
                {list.isDefault ? t('Retirer par défaut') : t('Définir par défaut')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (window.confirm(t('Supprimer cette liste de prix ?'))) remove.mutate();
                }}
              >
                {t('Supprimer')}
              </Button>
            </>
          }
        />
        <Header list={list} onPatch={(body) => patch.mutate(body)} />
      </Card>

      <Card>
        <CardHeader
          title={t('Articles et paliers')}
          description={t('Un palier s’applique à partir de sa quantité minimale. Une remise éventuelle est appliquée à la ligne.')}
        />
        <div className="border-b border-border p-4">
          <VariantPicker
            placeholder={t('Ajouter un article à la liste…')}
            onPick={(variant) =>
              addItem.mutate({
                variantId: variant.variantId,
                price: variant.sellingPrice ?? '0',
                minQuantity: '0',
              })
            }
          />
        </div>
        {list.items.length === 0 ? (
          <EmptyState icon="box" title={t('Aucun article')} description={t('Recherchez un article ci-dessus pour lui fixer un prix.')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('Article')}</Th>
                <Th numeric>{t('Qté min.')}</Th>
                <Th numeric>{t('Prix')} ({list.currency})</Th>
                <Th numeric>{t('Remise %')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
                <ItemRow
                  key={item.id + item.price + item.minQuantity + (item.discountPercent ?? '')}
                  item={item}
                  onSave={(body) => updateItem.mutate({ itemId: item.id, body })}
                  onTier={() =>
                    addItem.mutate({
                      variantId: item.variantId,
                      price: item.price,
                      minQuantity: String(Number(item.minQuantity) + 10),
                    })
                  }
                  onRemove={() => removeItem.mutate(item.id)}
                />
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ContactsCard list={list} onAssign={(body) => assign.mutate(body)} />
    </div>
  );
}

function Header({
  list,
  onPatch,
}: {
  list: PriceListDetail;
  onPatch: (body: { name?: string; currency?: string; isActive?: boolean; validFrom?: string | null; validTo?: string | null }) => void;
}) {
  const t = useT();
  const [name, setName] = useState(list.name);
  const [currency, setCurrency] = useState(list.currency);
  const [validFrom, setValidFrom] = useState(list.validFrom ?? '');
  const [validTo, setValidTo] = useState(list.validTo ?? '');

  return (
    <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
      <Field label={t('Nom')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== list.name && onPatch({ name: name.trim() })} />
      </Field>
      <Field label={t('Devise')}>
        <Input
          value={currency}
          maxLength={3}
          dir="ltr"
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          onBlur={() => currency.length === 3 && currency !== list.currency && onPatch({ currency })}
        />
      </Field>
      <Field label={t('Valide à partir du')}>
        <Input
          type="date"
          value={validFrom}
          onChange={(e) => setValidFrom(e.target.value)}
          onBlur={() => validFrom !== (list.validFrom ?? '') && onPatch({ validFrom: validFrom || null })}
        />
      </Field>
      <Field label={t('Valide jusqu’au')}>
        <Input
          type="date"
          value={validTo}
          onChange={(e) => setValidTo(e.target.value)}
          onBlur={() => validTo !== (list.validTo ?? '') && onPatch({ validTo: validTo || null })}
        />
      </Field>
      <div className="sm:col-span-2 lg:col-span-4">
        <Checkbox label={t('Liste active')} checked={list.isActive} onChange={(e) => onPatch({ isActive: e.target.checked })} />
      </div>
    </div>
  );
}

function ItemRow({
  item,
  onSave,
  onTier,
  onRemove,
}: {
  item: PriceListItem;
  onSave: (body: { price?: string; minQuantity?: string; discountPercent?: string | null }) => void;
  onTier: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [price, setPrice] = useState(item.price.replace(/0+$/, '').replace(/\.$/, ''));
  const [minQuantity, setMinQuantity] = useState(qty(item.minQuantity));
  const [discount, setDiscount] = useState(item.discountPercent ? item.discountPercent.replace(/0+$/, '').replace(/\.$/, '') : '');

  const norm = (value: string) => value.trim().replace(',', '.');

  return (
    <tr>
      <Td>
        <p className="text-sm font-medium text-ink">
          {item.productName}
          {item.variantLabel && <span className="text-ink-muted"> — {item.variantLabel}</span>}
        </p>
        <p className="text-xs text-ink-subtle">{item.sku}</p>
      </Td>
      <Td numeric>
        <NumberInput
          className="w-24"
          value={minQuantity}
          aria-label={t('Qté min.')}
          onChange={(e) => setMinQuantity(e.target.value)}
          onBlur={() => norm(minQuantity) !== '' && Number(norm(minQuantity)) !== Number(item.minQuantity) && onSave({ minQuantity: norm(minQuantity) })}
        />
      </Td>
      <Td numeric>
        <NumberInput
          className="w-28"
          value={price}
          aria-label={t('Prix')}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={() => norm(price) !== '' && Number(norm(price)) !== Number(item.price) && onSave({ price: norm(price) })}
        />
      </Td>
      <Td numeric>
        <NumberInput
          className="w-20"
          value={discount}
          placeholder="0"
          aria-label={t('Remise %')}
          onChange={(e) => setDiscount(e.target.value)}
          onBlur={() => {
            const next = norm(discount);
            const current = item.discountPercent ? Number(item.discountPercent) : null;
            if ((next === '' ? null : Number(next)) !== current) onSave({ discountPercent: next === '' ? null : next });
          }}
        />
      </Td>
      <Td className="whitespace-nowrap text-end">
        <Button size="sm" variant="ghost" onClick={onTier}>
          {t('+ Palier')}
        </Button>
        <IconButton label={t('Retirer')} onClick={onRemove}>
          <Icon name="x" />
        </IconButton>
      </Td>
    </tr>
  );
}

function ContactsCard({
  list,
  onAssign,
}: {
  list: PriceListDetail;
  onAssign: (body: { contactIds: string[]; replace: boolean }) => void;
}) {
  const t = useT();
  const [search, setSearch] = useState('');
  const contacts = useQuery({
    queryKey: ['contacts', 'price-list-picker', search],
    queryFn: async () => unwrap(await api.contacts.list({ query: { limit: 20, ...(search ? { search } : {}) } })),
    placeholderData: (previous) => previous,
  });
  const assignedIds = list.contacts.map((c) => c.id);

  return (
    <Card>
      <CardHeader title={t('Clients et fournisseurs')} description={t('Ces tiers voient les prix de cette liste sur leurs documents.')} />
      <div className="space-y-3 p-5">
        <div className="max-w-sm">
          <Combobox
            value=""
            placeholder={t('Ajouter un tiers…')}
            searchPlaceholder={t('Nom, ICE, téléphone…')}
            options={(contacts.data?.items ?? [])
              .filter((c) => !assignedIds.includes(c.id))
              .map((c) => ({ value: c.id, label: c.displayName, description: c.ice ?? undefined }))}
            loading={contacts.isFetching}
            onSearch={setSearch}
            onChange={(value) => value && onAssign({ contactIds: [value], replace: false })}
          />
        </div>
        {list.contacts.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('Aucun tiers assigné.')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {list.contacts.map((contact) => (
              <li key={contact.id} className="flex items-center gap-1 rounded-full border border-border bg-surface-muted py-1 ps-3 pe-1 text-sm">
                {contact.displayName}
                <IconButton
                  label={t('Retirer')}
                  className="size-6"
                  onClick={() => onAssign({ contactIds: assignedIds.filter((x) => x !== contact.id), replace: true })}
                >
                  <Icon name="x" className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
