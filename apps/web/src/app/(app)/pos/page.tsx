'use client';

import { Thumb } from '@/components/product-images';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { VariantSearchResult } from '@mizmar/contracts';
import { api, ApiError, unwrap } from '@/lib/api';
import { amount, money, paymentMethodLabel } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { Icon } from '@/components/icons';
import {
  CloseSessionDialog,
  MovementDialog,
  OpenSessionDialog,
  useRegisters,
  useSessionDetail,
} from '@/components/cash-dialogs';
import { usePosSettings } from '@/lib/use-pos';
import {
  Button,
  buttonClasses,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  IconButton,
  Input,
  LinkButton,
  NumberInput,
  SearchInput,
  Segmented,
  Select,
  toast,
} from '@/components/ui';

const WALK_IN_NAME = 'Client comptoir';
const METHODS = ['CASH', 'CARD', 'CHEQUE', 'BANK_TRANSFER'] as const;
type Method = (typeof METHODS)[number];

interface CartLine {
  variantId: string;
  name: string;
  sku: string;
  unitPrice: string;
  vatRate: string;
  quantity: number;
  isService: boolean;
  available: number;
}

interface Sale {
  documentId: string;
  paymentId: string | null;
  number: string | null;
  total: string;
  tendered: string;
  change: string;
  method: Method;
}

function lineName(item: VariantSearchResult): string {
  return item.variantLabel ? `${item.productName} · ${item.variantLabel}` : item.productName;
}

/** The selling screen. `sessionId` ties each payment to the open cash session, when there is one. */
function PosScreen({ sessionId }: { sessionId: string | null }) {
  const t = useT();
  const queryClient = useQueryClient();

  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [method, setMethod] = useState<Method>('CASH');
  const [tendered, setTendered] = useState('');
  const [discountPct, setDiscountPct] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(term.trim()), 200);
    return () => clearTimeout(handle);
  }, [term]);

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => unwrap(await api.inventory.listWarehouses()),
  });
  const activeWarehouses = useMemo(
    () => (warehouses.data ?? []).filter((warehouse) => warehouse.isActive !== false),
    [warehouses.data],
  );
  useEffect(() => {
    if (!warehouseId && activeWarehouses.length > 0) {
      setWarehouseId(activeWarehouses[0]!.id);
    }
  }, [activeWarehouses, warehouseId]);

  const clients = useQuery({
    queryKey: ['contacts', 'pos'],
    queryFn: async () => unwrap(await api.contacts.list({ query: { kind: 'CLIENT', limit: 100 } })),
  });

  const results = useQuery({
    queryKey: ['pos-search', debounced, warehouseId],
    enabled: debounced.length > 0 && Boolean(warehouseId),
    queryFn: async () =>
      unwrap(
        await api.catalog.searchVariants({
          query: { q: debounced, warehouseId, limit: 24 },
        }),
      ),
    placeholderData: (previous) => previous,
  });

  const addItem = (item: VariantSearchResult) => {
    setCart((current) => {
      const existing = current.find((line) => line.variantId === item.variantId);
      if (existing) {
        return current.map((line) =>
          line.variantId === item.variantId ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...current,
        {
          variantId: item.variantId,
          name: lineName(item),
          sku: item.sku,
          unitPrice: item.sellingPrice ?? '0',
          vatRate: item.vatRate,
          quantity: 1,
          isService: item.isService,
          available: Number(item.available),
        },
      ];
    });
  };

  // A scanner types the barcode then presses Enter: add the exact match straight away.
  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const value = term.trim();
    const match =
      results.data?.find((item) => item.barcode === value || item.sku === value) ??
      (results.data?.length === 1 ? results.data[0] : undefined);
    if (match) {
      addItem(match);
      setTerm('');
      setDebounced('');
    }
  };

  const setQuantity = (variantId: string, quantity: number) =>
    setCart((current) =>
      quantity <= 0
        ? current.filter((line) => line.variantId !== variantId)
        : current.map((line) => (line.variantId === variantId ? { ...line, quantity } : line)),
    );

  const setPrice = (variantId: string, unitPrice: string) =>
    setCart((current) =>
      current.map((line) => (line.variantId === variantId ? { ...line, unitPrice } : line)),
    );

  const discount = Number(discountPct) > 0 ? Math.min(Number(discountPct), 100) : 0;

  const totals = useQuery({
    queryKey: ['pos-totals', cart, discount],
    enabled: cart.length > 0,
    queryFn: async () =>
      unwrap(
        await api.documents.totalsPreview({
          body: {
            globalDiscount: discount > 0 ? { kind: 'PERCENT', value: String(discount) } : null,
            lines: cart.map((line) => ({
              id: line.variantId,
              quantity: line.quantity,
              unitPrice: line.unitPrice || '0',
              vatRate: line.vatRate,
            })),
          },
        }),
      ),
    placeholderData: (previous) => previous,
  });

  const total = cart.length === 0 ? '0.00' : (totals.data?.totalInclVat ?? '0.00');
  const tenderedValue = tendered === '' ? Number(total) : Number(tendered);
  const change = method === 'CASH' ? Math.max(0, tenderedValue - Number(total)) : 0;
  const short = method === 'CASH' && tendered !== '' && tenderedValue < Number(total);

  const reset = () => {
    setCart([]);
    setTendered('');
    setDiscountPct('');
    setCustomerId('');
    setTerm('');
    setDebounced('');
    setMethod('CASH');
    setError(null);
    setSale(null);
    document.getElementById('pos-search')?.focus();
  };

  /** The walk-in customer is one shared contact, created the first time it is needed. */
  const resolveCustomer = async (): Promise<string> => {
    if (customerId) return customerId;
    const found = unwrap(
      await api.contacts.list({ query: { kind: 'CLIENT', search: WALK_IN_NAME, limit: 20 } }),
    ).items.find((contact) => contact.displayName === WALK_IN_NAME);
    if (found) return found.id;
    return unwrap(
      await api.contacts.create({
        body: { kind: 'CLIENT', displayName: WALK_IN_NAME, paymentTerm: 'IMMEDIATE' },
      }),
    ).id;
  };

  const checkout = useMutation({
    mutationFn: async (): Promise<Sale> => {
      setError(null);
      const contactId = await resolveCustomer();
      const today = new Date().toISOString().slice(0, 10);

      const draft = unwrap(
        await api.documents.create({
          body: {
            type: 'SALES_INVOICE',
            contactId,
            warehouseId,
            issueDate: today,
            dueDate: today,
            globalDiscount: discount > 0 ? { kind: 'PERCENT', value: String(discount) } : null,
            internalMemo: 'Vente comptoir',
            lines: cart.map((line) => ({
              variantId: line.variantId,
              warehouseId,
              description: line.name,
              quantity: line.quantity,
              unitPrice: line.unitPrice || '0',
              vatRate: line.vatRate,
              isService: line.isService,
            })),
          },
        }),
      );

      const issued = unwrap(
        await api.documents.validate({
          params: { id: draft.id },
          body: { confirmNegativeStock: true },
        }),
      );

      const due = issued.totals.totalInclVat;
      let paymentId: string | null = null;
      if (Number(due) > 0) {
        paymentId = unwrap(
          await api.payments.create({
            body: {
              contactId,
              method,
              amount: due,
              paidAt: today,
              note: 'Vente comptoir',
              cashSessionId: sessionId,
              allocations: [{ documentId: issued.id, amount: due }],
            },
          }),
        ).id;
      }

      return {
        documentId: issued.id,
        paymentId,
        number: issued.number,
        total: due,
        tendered: method === 'CASH' && tendered !== '' ? tendered : due,
        change: change.toFixed(2),
        method,
      };
    },
    onSuccess: (done) => {
      void queryClient.invalidateQueries({ queryKey: ['cash'] });
      setSale(done);
      toast.success(t('Vente enregistrée'));
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Encaissement impossible')),
  });

  const lowStock = cart.filter((line) => !line.isService && line.quantity > line.available);

  if (sale) {
    return (
      <div className="mx-auto max-w-md pt-10">
        <Card>
          <div className="space-y-5 p-8 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand">
              <Icon name="check" className="size-7" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-ink">{t('Vente encaissée')}</h1>
              <p className="mt-1 text-sm text-ink-muted">{sale.number}</p>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">{t('Total')}</dt>
                <dd className="font-semibold tabular-nums">{money(sale.total)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">{paymentMethodLabel(sale.method)}</dt>
                <dd className="tabular-nums">{money(sale.tendered)}</dd>
              </div>
              {Number(sale.change) > 0 && (
                <div className="flex justify-between text-base">
                  <dt className="font-medium">{t('À rendre')}</dt>
                  <dd className="font-semibold tabular-nums text-brand">{money(sale.change)}</dd>
                </div>
              )}
            </dl>
            <div className="flex flex-col gap-2">
              <Button variant="primary" onClick={reset}>
                {t('Nouvelle vente')}
              </Button>
              {sale.paymentId && (
                <a
                  href={`/receipt/${sale.paymentId}?print=1`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClasses('secondary')}
                >
                  {t('Imprimer le reçu')}
                </a>
              )}
              <LinkButton href={`/documents/${sale.documentId}`} variant="secondary">
                {t('Voir la facture')}
              </LinkButton>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('Caisse')}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {t('Scannez ou recherchez un article, encaissez, la facture est émise et réglée.')}
          </p>
        </div>
        <div className="w-56">
          <Select
            aria-label={t('Entrepôt')}
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
          >
            {activeWarehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_26rem]">
        <section className="space-y-3">
          <SearchInput
            id="pos-search"
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={onSearchKey}
            placeholder={t('Code-barres, référence ou nom…')}
          />
          {debounced === '' ? (
            <EmptyState
              icon="search"
              title={t('Prêt à scanner')}
              description={t('Le code-barres exact est ajouté au panier avec Entrée.')}
            />
          ) : results.data && results.data.length === 0 ? (
            <EmptyState icon="box" title={t('Aucun article trouvé')} />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {(results.data ?? []).map((item) => {
                const out = !item.isService && Number(item.available) <= 0;
                return (
                  <button
                    key={item.variantId}
                    type="button"
                    onClick={() => addItem(item)}
                    className="rounded-xl border border-border bg-surface p-3 text-start transition hover:border-brand hover:bg-brand-soft"
                  >
                    <Thumb url={item.imageUrl} className="mb-2 aspect-[4/3] h-auto w-full" />
                    <p className="line-clamp-2 text-sm font-medium text-ink">{lineName(item)}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">{item.sku}</p>
                    <div className="mt-2 flex items-end justify-between">
                      <span className="text-sm font-semibold tabular-nums text-ink">
                        {money(item.sellingPrice ?? '0')}
                      </span>
                      <span
                        className={
                          out ? 'text-xs font-medium text-danger' : 'text-xs text-ink-muted'
                        }
                      >
                        {item.isService ? t('Service') : `${amount(item.available)} ${t('en stock')}`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <Card className="h-fit lg:sticky lg:top-4">
          <div className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">
                {t('Panier')} {cart.length > 0 && `(${cart.length})`}
              </h2>
              {cart.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-ink-muted hover:text-danger"
                  onClick={reset}
                >
                  {t('Vider')}
                </button>
              )}
            </div>

            {cart.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-muted">{t('Le panier est vide')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {cart.map((line) => (
                  <li key={line.variantId} className="space-y-2 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-ink">{line.name}</p>
                      <IconButton
                        label={t('Retirer')}
                        onClick={() => setQuantity(line.variantId, 0)}
                      >
                        <Icon name="x" />
                      </IconButton>
                    </div>
                    <div className="flex items-center gap-2">
                      <IconButton
                        label="−"
                        onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                      >
                        <span aria-hidden>−</span>
                      </IconButton>
                      <NumberInput
                        aria-label={t('Quantité')}
                        className="w-16 text-center"
                        value={line.quantity}
                        min={0}
                        step="any"
                        onChange={(event) =>
                          setQuantity(line.variantId, Number(event.target.value) || 0)
                        }
                      />
                      <IconButton
                        label="+"
                        onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                      >
                        <Icon name="plus" />
                      </IconButton>
                      <span className="text-ink-subtle">×</span>
                      <NumberInput
                        aria-label={t('Prix unitaire')}
                        className="w-24 text-end"
                        value={line.unitPrice}
                        min={0}
                        step="0.01"
                        onChange={(event) => setPrice(line.variantId, event.target.value)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {lowStock.length > 0 && (
              <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-ink-muted">
                {t('Stock insuffisant pour {n} article(s) : la vente passera le stock en négatif.', {
                  n: lowStock.length,
                })}
              </p>
            )}

            <div className="space-y-3 border-t border-border pt-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('Remise %')}>
                  <NumberInput
                    value={discountPct}
                    min={0}
                    max={100}
                    step="any"
                    onChange={(event) => setDiscountPct(event.target.value)}
                  />
                </Field>
                <Field label={t('Client')}>
                  <Select
                    value={customerId}
                    onChange={(event) => setCustomerId(event.target.value)}
                  >
                    <option value="">{t(WALK_IN_NAME)}</option>
                    {(clients.data?.items ?? [])
                      .filter((contact) => contact.displayName !== WALK_IN_NAME)
                      .map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.displayName}
                        </option>
                      ))}
                  </Select>
                </Field>
              </div>

              <dl className="space-y-1 text-sm">
                <div className="flex justify-between text-ink-muted">
                  <dt>{t('Total HT')}</dt>
                  <dd className="tabular-nums">{money(totals.data?.totalExclVat ?? '0')}</dd>
                </div>
                <div className="flex justify-between text-ink-muted">
                  <dt>{t('TVA')}</dt>
                  <dd className="tabular-nums">{money(totals.data?.totalVat ?? '0')}</dd>
                </div>
                <div className="flex justify-between text-lg font-semibold text-ink">
                  <dt>{t('Total TTC')}</dt>
                  <dd className="tabular-nums">{money(total)}</dd>
                </div>
              </dl>

              <Segmented
                value={method}
                onChange={setMethod}
                options={METHODS.map((value) => ({ value, label: paymentMethodLabel(value) }))}
              />

              {method === 'CASH' && (
                <div className="grid grid-cols-2 items-end gap-3">
                  <Field label={t('Montant reçu')}>
                    <NumberInput
                      value={tendered}
                      min={0}
                      step="0.01"
                      placeholder={total}
                      onChange={(event) => setTendered(event.target.value)}
                    />
                  </Field>
                  <div className="pb-2 text-end">
                    <p className="text-xs text-ink-muted">{t('À rendre')}</p>
                    <p className="text-lg font-semibold tabular-nums text-brand">
                      {money(change.toFixed(2))}
                    </p>
                  </div>
                </div>
              )}

              <ErrorNote>{error}</ErrorNote>

              <Button
                variant="primary"
                className="w-full"
                disabled={cart.length === 0 || !warehouseId || short || totals.isFetching}
                loading={checkout.isPending}
                onClick={() => checkout.mutate()}
              >
                {t('Encaisser')} {money(total)}
              </Button>
              {short && (
                <p className="text-center text-xs text-danger">
                  {t('Le montant reçu est inférieur au total.')}
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

/**
 * Gatekeeper: honours the on/off switch, picks the register and shows the shift
 * (cash session) bar. With "require session" on, nothing sells until a shift is open.
 */
export default function PosPage() {
  const t = useT();
  const router = useRouter();
  const pos = usePosSettings();
  const registers = useRegisters(pos.enabled);
  const [pickedId, setPickedId] = useState('');
  const [dialog, setDialog] = useState<'open' | 'move' | 'close' | null>(null);

  const active = (registers.data ?? []).filter((register) => register.isActive);
  const register =
    active.find((r) => r.id === pickedId) ?? active.find((r) => r.openSession) ?? active[0] ?? null;
  const sessionId = register?.openSession?.id ?? null;
  const session = useSessionDetail(sessionId);

  if (!pos.ready) return <p className="p-8 text-center text-sm text-ink-muted">…</p>;

  if (!pos.enabled) {
    return (
      <Card className="mx-auto mt-10 max-w-xl">
        <EmptyState
          icon="wallet"
          title={t('La caisse est désactivée')}
          description={t('Activez-la dans Paramètres › Caisse pour encaisser des ventes au comptoir.')}
          action={
            <LinkButton href="/settings/pos" variant="primary">
              {t('Ouvrir les paramètres de la caisse')}
            </LinkButton>
          }
        />
      </Card>
    );
  }

  if (registers.isPending) return <p className="p-8 text-center text-sm text-ink-muted">…</p>;
  if (!register) {
    return (
      <Card className="mx-auto mt-10 max-w-xl">
        <EmptyState
          icon="wallet"
          title={t('Aucune caisse active')}
          description={t('Ajoutez ou réactivez une caisse dans Paramètres › Caisse.')}
          action={
            <LinkButton href="/settings/pos" variant="primary">
              {t('Ouvrir les paramètres de la caisse')}
            </LinkButton>
          }
        />
      </Card>
    );
  }

  const bar = (
    <Card className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 p-3">
      {active.length > 1 && (
        <div className="w-44">
          <Select aria-label={t('Caisse')} value={register.id} onChange={(e) => setPickedId(e.target.value)}>
            {active.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.openSession ? ' ●' : ''}
              </option>
            ))}
          </Select>
        </div>
      )}
      {sessionId && session.data ? (
        <>
          <div className="text-sm">
            <span className="font-semibold text-ink">
              {register.name} · {t('Session {n}', { n: session.data.number })}
            </span>
            <span className="ms-2 text-ink-muted">
              {t('ouverte par {name}', { name: session.data.openedByName })}
            </span>
          </div>
          <div className="text-sm text-ink-muted">
            {t('Ventes')} :{' '}
            <span className="tabular font-medium text-ink">
              {money(session.data.salesTotal, session.data.currency)} ({session.data.salesCount})
            </span>
          </div>
          <div className="text-sm text-ink-muted">
            {t('Espèces attendues')} :{' '}
            <span className="tabular font-medium text-ink">
              {money(session.data.expectedCash, session.data.currency)}
            </span>
          </div>
          <div className="ms-auto flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDialog('move')}>
              {t('Entrée / sortie')}
            </Button>
            <Button variant="danger" size="sm" onClick={() => setDialog('close')}>
              {t('Clôturer')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <span className="text-sm text-ink-muted">
            {pos.requireSession
              ? t('Ouvrez la caisse pour commencer à vendre.')
              : t('Aucune session ouverte : les ventes ne seront pas rattachées à une caisse.')}
          </span>
          <div className="ms-auto">
            <Button variant="primary" size="sm" onClick={() => setDialog('open')}>
              {t('Ouvrir la caisse')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );

  const blocked = pos.requireSession && !sessionId;

  return (
    <>
      {bar}
      {blocked ? (
        <Card>
          <EmptyState
            icon="wallet"
            title={t('La caisse est fermée')}
            description={t('Une session ouverte est requise pour encaisser. Indiquez le fonds de caisse pour commencer.')}
            action={
              <Button variant="primary" onClick={() => setDialog('open')}>
                {t('Ouvrir la caisse')}
              </Button>
            }
          />
        </Card>
      ) : (
        <PosScreen key={sessionId ?? 'none'} sessionId={sessionId} />
      )}

      {dialog === 'open' && (
        <OpenSessionDialog registerId={register.id} registerName={register.name} onClose={() => setDialog(null)} />
      )}
      {dialog === 'move' && sessionId && (
        <MovementDialog sessionId={sessionId} currency={pos.currency} onClose={() => setDialog(null)} />
      )}
      {dialog === 'close' && session.data && (
        <CloseSessionDialog
          session={session.data}
          onClose={() => setDialog(null)}
          onClosed={(id) => router.push(`/pos/sessions/${id}`)}
        />
      )}
    </>
  );
}
