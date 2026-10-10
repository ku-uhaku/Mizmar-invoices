'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { lotSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { apiModules, ApiError, unwrap } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  NumberInput,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  StatCard,
  Table,
  TableSkeleton,
  Td,
  Textarea,
  Th,
  toast,
} from '@/components/ui';
import { amount, date, dateTime, money, qty } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

type Lot = z.infer<typeof lotSchemas.lotItem>;
type Unassigned = z.infer<typeof lotSchemas.unassignedItem>;
type Tab = 'lots' | 'unassigned' | 'items';
type Filter = 'all' | 'expiring' | 'expired';

const TRACKING_LABEL = { NONE: 'Non suivi', LOT: 'Par lot', SERIAL: 'N° de série' } as const;

function expiryTone(days: number | null): 'danger' | 'progress' | 'neutral' {
  if (days === null) return 'neutral';
  if (days < 0) return 'danger';
  return days <= 30 ? 'progress' : 'neutral';
}

export default function LotsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('lots');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [assigning, setAssigning] = useState<Unassigned | null>(null);
  const [writingOff, setWritingOff] = useState<Lot | null>(null);
  const [tracing, setTracing] = useState<Lot | null>(null);

  const lots = useQuery({
    queryKey: ['lots', 'list', filter, search],
    enabled: tab === 'lots',
    queryFn: async () =>
      unwrap(
        await apiModules.lots.list({
          query: { filter, days: 60, ...(search.trim() ? { search: search.trim() } : {}) },
        }),
      ),
  });
  const summary = useQuery({
    queryKey: ['lots', 'summary'],
    queryFn: async () => unwrap(await apiModules.lots.list({ query: { filter: 'all', days: 60 } })),
  });
  const unassigned = useQuery({
    queryKey: ['lots', 'unassigned'],
    queryFn: async () => unwrap(await apiModules.lots.unassigned({})),
  });
  const items = useQuery({
    queryKey: ['lots', 'variants', search],
    enabled: tab === 'items',
    queryFn: async () => unwrap(await apiModules.lots.tracked({ query: { ...(search.trim() ? { search: search.trim() } : {}) } })),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['lots'] });
  const fail = (cause: unknown) => toast.error(cause instanceof ApiError ? cause.message : t('Enregistrement impossible'));

  const setTracking = useMutation({
    mutationFn: async (input: { variantId: string; tracking: 'NONE' | 'LOT' | 'SERIAL' }) =>
      unwrap(await apiModules.lots.setTracking({ body: input })),
    onSuccess: refresh,
    onError: fail,
  });

  const s = summary.data?.summary;

  return (
    <>
      <PageHeader
        title={t('Lots et péremptions')}
        subtitle={t('Traçabilité par lot ou numéro de série, avec dates limites')}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('Périmés')} value={s?.expired.count ?? 0} hint={money(s?.expired.value ?? '0')} icon="alert" tone={s && s.expired.count > 0 ? 'danger' : 'neutral'} />
        <StatCard label={t('Expirent sous 30 jours')} value={s?.within30.count ?? 0} hint={money(s?.within30.value ?? '0')} icon="clock" tone={s && s.within30.count > 0 ? 'progress' : 'neutral'} />
        <StatCard label={t('Expirent sous 60 jours')} value={s?.within60.count ?? 0} hint={money(s?.within60.value ?? '0')} icon="clock" />
        <StatCard label={t('À attribuer à un lot')} value={unassigned.data?.length ?? 0} icon="box" tone={unassigned.data?.length ? 'progress' : 'neutral'} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'lots', label: t('Lots en stock') },
            { value: 'unassigned', label: t('À attribuer'), count: unassigned.data?.length },
            { value: 'items', label: t('Articles suivis') },
          ]}
        />
        {tab === 'lots' && (
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('Tous') },
              { value: 'expiring', label: t('Bientôt périmés') },
              { value: 'expired', label: t('Périmés') },
            ]}
          />
        )}
        {tab !== 'unassigned' && (
          <SearchInput
            className="w-full sm:ms-auto sm:w-64"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('Article, SKU, n° de lot…')}
          />
        )}
      </div>

      <Card className="overflow-hidden">
        {tab === 'lots' &&
          (lots.isPending ? (
            <TableSkeleton rows={6} cols={7} />
          ) : (lots.data?.items ?? []).length === 0 ? (
            <EmptyState
              icon="box"
              title={t('Aucun lot')}
              description={t('Activez le suivi sur un article, puis attribuez son stock à des lots.')}
            />
          ) : (
            <Table className="min-w-[900px]">
              <thead>
                <tr>
                  <Th>{t('Article')}</Th>
                  <Th>{t('Lot / série')}</Th>
                  <Th>{t('Entrepôt')}</Th>
                  <Th>{t('Péremption')}</Th>
                  <Th numeric>{t('Quantité')}</Th>
                  <Th numeric>{t('Valeur')}</Th>
                  <Th className="w-44" />
                </tr>
              </thead>
              <tbody>
                {lots.data!.items.map((lot) => (
                  <tr key={lot.id} className="hover:bg-surface-muted/60">
                    <Td>
                      <span className="font-medium">{lot.productName}</span>
                      <span className="block text-xs text-ink-subtle">
                        {lot.sku}
                        {lot.variantLabel ? ` · ${lot.variantLabel}` : ''}
                      </span>
                    </Td>
                    <Td className="font-mono text-sm">{lot.lotNumber}</Td>
                    <Td className="text-ink-muted">{lot.warehouseName}</Td>
                    <Td className="whitespace-nowrap">
                      {lot.expiryDate ? (
                        <Badge tone={expiryTone(lot.daysToExpiry)}>
                          {date(lot.expiryDate)}
                          {lot.daysToExpiry !== null &&
                            ` · ${lot.daysToExpiry < 0 ? t('périmé') : t('{n} j', { n: lot.daysToExpiry })}`}
                        </Badge>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </Td>
                    <Td numeric className="font-semibold">{qty(lot.quantity)}</Td>
                    <Td numeric className="text-ink-muted">{amount(lot.stockValue)}</Td>
                    <Td>
                      <span className="flex justify-end gap-1.5">
                        <Button size="sm" onClick={() => setTracing(lot)}>
                          {t('Historique')}
                        </Button>
                        <Button size="sm" onClick={() => setWritingOff(lot)}>
                          {t('Sortir')}
                        </Button>
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}

        {tab === 'unassigned' &&
          (unassigned.isPending ? (
            <TableSkeleton rows={4} cols={5} />
          ) : (unassigned.data ?? []).length === 0 ? (
            <EmptyState icon="check" title={t('Tout est attribué')} description={t('Le stock des articles suivis est entièrement réparti en lots.')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('Article')}</Th>
                  <Th>{t('Suivi')}</Th>
                  <Th>{t('Entrepôt')}</Th>
                  <Th numeric>{t('En stock')}</Th>
                  <Th numeric>{t('Attribué')}</Th>
                  <Th numeric>{t('À attribuer')}</Th>
                  <Th className="w-32" />
                </tr>
              </thead>
              <tbody>
                {unassigned.data!.map((row) => (
                  <tr key={`${row.variantId}-${row.warehouseId}`}>
                    <Td>
                      <span className="font-medium">{row.productName}</span>
                      <span className="block text-xs text-ink-subtle">{row.sku}</span>
                    </Td>
                    <Td><Badge>{t(TRACKING_LABEL[row.tracking])}</Badge></Td>
                    <Td className="text-ink-muted">{row.warehouseName}</Td>
                    <Td numeric>{qty(row.onHand)}</Td>
                    <Td numeric className="text-ink-muted">{qty(row.assigned)}</Td>
                    <Td numeric className="font-semibold text-warning">{qty(row.unassigned)}</Td>
                    <Td>
                      <Button size="sm" variant="primary" onClick={() => setAssigning(row)}>
                        {t('Attribuer')}
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}

        {tab === 'items' &&
          (items.isPending ? (
            <TableSkeleton rows={6} cols={4} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('Article')}</Th>
                  <Th numeric>{t('En stock')}</Th>
                  <Th>{t('Suivi')}</Th>
                </tr>
              </thead>
              <tbody>
                {items.data!.map((item) => (
                  <tr key={item.variantId}>
                    <Td>
                      <span className="font-medium">{item.productName}</span>
                      <span className="block text-xs text-ink-subtle">
                        {item.sku}
                        {item.variantLabel ? ` · ${item.variantLabel}` : ''}
                      </span>
                    </Td>
                    <Td numeric>{qty(item.onHand)}</Td>
                    <Td>
                      <Select
                        className="w-44"
                        value={item.tracking}
                        onChange={(event) =>
                          setTracking.mutate({ variantId: item.variantId, tracking: event.target.value as Lot['tracking'] })
                        }
                      >
                        {(Object.keys(TRACKING_LABEL) as Array<keyof typeof TRACKING_LABEL>).map((key) => (
                          <option key={key} value={key}>
                            {t(TRACKING_LABEL[key])}
                          </option>
                        ))}
                      </Select>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}
      </Card>

      {assigning && <AssignDialog row={assigning} onClose={() => setAssigning(null)} onDone={refresh} />}
      {writingOff && <WriteOffDialog lot={writingOff} onClose={() => setWritingOff(null)} onDone={refresh} />}
      {tracing && <TraceDialog lot={tracing} onClose={() => setTracing(null)} />}
    </>
  );
}

function AssignDialog({ row, onClose, onDone }: { row: Unassigned; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const serial = row.tracking === 'SERIAL';
  const [lotNumber, setLotNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [quantity, setQuantity] = useState(row.unassigned);
  const [serials, setSerials] = useState('');
  const [error, setError] = useState<string | null>(null);

  const list = serials.split(/[\n,;]+/).map((entry) => entry.trim()).filter(Boolean);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await apiModules.lots.assign({
          body: {
            variantId: row.variantId,
            warehouseId: row.warehouseId,
            expiryDate: expiry || null,
            ...(serial ? { serials: list } : { lotNumber: lotNumber.trim(), quantity }),
          },
        }),
      );
    },
    onSuccess: () => {
      onDone();
      toast.success(t('Stock attribué'));
      onClose();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  const ready = serial ? list.length > 0 && list.length <= Number(row.unassigned) : lotNumber.trim() !== '' && Number(quantity) > 0 && Number(quantity) <= Number(row.unassigned);

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={serial ? t('Attribuer des numéros de série') : t('Attribuer à un lot')}
      description={`${row.productName} · ${row.warehouseName} · ${t('{n} à attribuer', { n: qty(row.unassigned) })}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('Annuler')}</Button>
          <Button variant="primary" loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        {serial ? (
          <Field label={t('Numéros de série')} hint={t('Un par ligne — {n} saisi(s)', { n: list.length })} required>
            <Textarea rows={6} value={serials} onChange={(event) => setSerials(event.target.value)} />
          </Field>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('N° de lot')} required>
              <Input value={lotNumber} onChange={(event) => setLotNumber(event.target.value)} autoFocus />
            </Field>
            <Field label={t('Quantité')} required>
              <NumberInput value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </Field>
          </div>
        )}
        <Field label={t('Date de péremption')}>
          <Input type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function WriteOffDialog({ lot, onClose, onDone }: { lot: Lot; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [quantity, setQuantity] = useState(lot.quantity);
  const [reason, setReason] = useState<'EXPIRED' | 'DAMAGED' | 'LOST' | 'OTHER'>(
    lot.daysToExpiry !== null && lot.daysToExpiry < 0 ? 'EXPIRED' : 'DAMAGED',
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await apiModules.lots.writeOff({
          params: { id: lot.id },
          body: { quantity, reason, note: note.trim() || undefined },
        }),
      );
    },
    onSuccess: () => {
      onDone();
      void queryClient.invalidateQueries();
      toast.success(t('Sortie de stock enregistrée'));
      onClose();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Sortir du stock')}
      description={`${lot.productName} · ${t('lot')} ${lot.lotNumber}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('Annuler')}</Button>
          <Button variant="primary" loading={save.isPending} disabled={!(Number(quantity) > 0 && Number(quantity) <= Number(lot.quantity))} onClick={() => save.mutate()}>
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Quantité')} hint={t('Dans le lot : {n}', { n: qty(lot.quantity) })}>
            <NumberInput value={quantity} onChange={(event) => setQuantity(event.target.value)} autoFocus />
          </Field>
          <Field label={t('Motif')}>
            <Select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}>
              <option value="EXPIRED">{t('Périmé')}</option>
              <option value="DAMAGED">{t('Endommagé')}</option>
              <option value="LOST">{t('Perdu')}</option>
              <option value="OTHER">{t('Autre')}</option>
            </Select>
          </Field>
        </div>
        <Field label={t('Note')}>
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function TraceDialog({ lot, onClose }: { lot: Lot; onClose: () => void }) {
  const t = useT();
  const trace = useQuery({
    queryKey: ['lots', 'trace', lot.id],
    queryFn: async () => unwrap(await apiModules.lots.trace({ params: { id: lot.id } })),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="md"
      title={`${t('Historique du lot')} ${lot.lotNumber}`}
      description={lot.productName}
      footer={<Button variant="ghost" onClick={onClose}>{t('Fermer')}</Button>}
    >
      {trace.isPending ? (
        <TableSkeleton rows={3} cols={3} />
      ) : (trace.data ?? []).length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">{t('Aucun mouvement pour ce lot.')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {trace.data!.map((row, index) => (
            <li key={index} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="w-28 shrink-0 text-xs text-ink-muted">{dateTime(row.at)}</span>
              <span className="min-w-0 flex-1">
                {row.documentNumber ? (
                  <>
                    <span className="font-medium">{row.documentNumber}</span>
                    {row.contactName && <span className="text-ink-muted"> — {row.contactName}</span>}
                  </>
                ) : (
                  <span className="text-ink-muted">{row.note ?? row.type}</span>
                )}
              </span>
              <span className={`tabular font-semibold ${Number(row.quantity) < 0 ? 'text-danger' : 'text-positive'}`}>
                {Number(row.quantity) > 0 ? '+' : ''}
                {qty(row.quantity)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
