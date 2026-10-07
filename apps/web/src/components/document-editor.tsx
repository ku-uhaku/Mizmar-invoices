'use client';

import { computeTotals, meta as documentMeta, type DocumentType } from '@mizmar/core';
import type { DocumentDetail, VariantSearchResult } from '@mizmar/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, unwrap } from '@/lib/api';
import { amount, documentTypeLabel, money, percent } from '@/lib/format';
import clsx from 'clsx';
import {
  Button,
  Card,
  CardHeader,
  Checkbox,
  ErrorNote,
  Field,
  IconButton,
  Input,
  Select,
  NumberInput,
  Textarea,
  toast,
} from './ui';
import { Icon } from './icons';
import { VariantPicker } from './variant-picker';
import { Combobox } from './combobox';
import { ContactForm } from './contact-form';
import { useT } from '@/lib/i18n/provider';

/** One editable row. Quantities and prices stay strings: no float ever. */
interface EditLine {
  key: string;
  id?: string;
  variantId: string | null;
  warehouseId: string | null;
  description: string;
  variantLabel: string | null;
  sku: string | null;
  unitCode: string | null;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  discountKind: 'PERCENT' | 'AMOUNT' | null;
  discountValue: string;
  isNote: boolean;
  isService: boolean;
  available: string | null;
  /** Quantity already drawn downstream; a converted line cannot go below it. */
  drawnQuantity: string;
  sourceReference: string | null;
  /** True once the user typed a price: automatic price resolution then leaves the line alone. */
  priceTouched?: boolean;
}

function toEditLine(line: DocumentDetail['lines'][number]): EditLine {
  return {
    key: line.id,
    id: line.id,
    variantId: line.variantId,
    warehouseId: line.warehouseId,
    description: line.description,
    variantLabel: line.variantLabel,
    sku: line.sku,
    unitCode: line.unitCode,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    vatRate: line.vatRate,
    discountKind: line.discountKind,
    discountValue: line.discountValue ?? '',
    isNote: line.isNote,
    isService: line.isService,
    available: line.available ?? null,
    drawnQuantity: line.drawnQuantity,
    sourceReference: line.sources[0]?.sourceDocumentNumber ?? null,
  };
}

export function DocumentEditor({ document }: { document: DocumentDetail }) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [lines, setLines] = useState<EditLine[]>(() => document.lines.map(toEditLine));
  const [contactId, setContactId] = useState(document.contactId);
  const [issueDate, setIssueDate] = useState(document.issueDate);
  const [dueDate, setDueDate] = useState(document.dueDate ?? '');
  const [validUntil, setValidUntil] = useState(document.validUntil ?? '');
  const [warehouseId, setWarehouseId] = useState(document.warehouseId ?? '');
  const [reference, setReference] = useState(document.reference ?? '');
  const [projectName, setProjectName] = useState(document.projectName ?? '');
  const [notes, setNotes] = useState(document.notes ?? '');
  const [terms, setTerms] = useState(document.terms ?? '');
  const [globalDiscountKind, setGlobalDiscountKind] = useState<'PERCENT' | 'AMOUNT' | ''>(
    document.globalDiscountKind ?? '',
  );
  const [globalDiscountValue, setGlobalDiscountValue] = useState(
    document.globalDiscountValue ?? '',
  );
  const [returnToStock, setReturnToStock] = useState(document.returnToStock);
  const [currency, setCurrency] = useState(document.currency);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const typeMeta = documentMeta(document.type as DocumentType);

  // Contacts are searched on the server as the user types, so a directory of
  // thousands is reachable without loading it all.
  const [contactSearch, setContactSearch] = useState('');
  const [creatingContact, setCreatingContact] = useState<string | null>(null);
  const [contactLabel, setContactLabel] = useState(document.contactName);
  const contactKind = ['PURCHASE_ORDER', 'GOODS_RECEIPT', 'PURCHASE_INVOICE'].includes(document.type)
    ? 'SUPPLIER'
    : 'CLIENT';
  const contacts = useQuery({
    queryKey: ['contacts', 'picker', contactKind, contactSearch],
    queryFn: async () =>
      unwrap(
        await api.contacts.list({
          query: { limit: 20, kind: contactKind, ...(contactSearch ? { search: contactSearch } : {}) },
        }),
      ),
    placeholderData: (previous) => previous,
  });
  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => unwrap(await api.inventory.listWarehouses()),
  });

  const company = useQuery({
    queryKey: ['company', document.companyId],
    queryFn: async () => unwrap(await api.companies.get({ params: { id: document.companyId } })),
  });
  const companyCurrency = company.data?.defaultCurrency ?? document.currency;
  const rateTable = useQuery({
    queryKey: ['exchange-rates', 'all'],
    queryFn: async () => unwrap(await api.pricing.listExchangeRates({ query: {} })),
  });
  const currencyOptions = useMemo(() => {
    const codes = new Set<string>([companyCurrency, document.currency, currency]);
    for (const row of rateTable.data ?? []) {
      codes.add(row.baseCurrency);
      codes.add(row.quoteCurrency);
    }
    return [...codes].sort();
  }, [companyCurrency, document.currency, currency, rateTable.data]);
  const rateHint = useQuery({
    queryKey: ['exchange-rate', currency, companyCurrency, issueDate],
    queryFn: async () =>
      unwrap(
        await api.pricing.lookupExchangeRate({
          query: { base: currency, quote: companyCurrency, date: issueDate },
        }),
      ),
    enabled: currency !== companyCurrency,
    retry: false,
  });

  /**
   * Resolve a unit price on the server (contact list > default list > base
   * price, converted to the document currency). A line the user priced by hand
   * is never overwritten.
   */
  async function resolveInto(key: string, variantId: string, quantity: string, cur: string) {
    try {
      const resolved = unwrap(
        await api.pricing.resolve({
          query: { variantId, quantity, currency: cur, date: issueDate, ...(contactId ? { contactId } : {}) },
        }),
      );
      setLines((current) =>
        current.map((line) =>
          line.key !== key || line.priceTouched
            ? line
            : {
                ...line,
                unitPrice: resolved.unitPrice,
                ...(resolved.discountPercent && !line.discountValue
                  ? { discountKind: 'PERCENT' as const, discountValue: resolved.discountPercent }
                  : {}),
              },
        ),
      );
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : t('Prix introuvable'));
    }
  }

  function changeCurrency(next: string) {
    setCurrency(next);
    // Existing prices are in the old currency: re-price every line the user did not set by hand.
    for (const line of lines) {
      if (line.variantId && !line.priceTouched && !line.isNote) {
        void resolveInto(line.key, line.variantId, line.quantity || '1', next);
      }
    }
  }

  /**
   * Totals recomputed locally on every keystroke with the same engine the API
   * uses, so the figure under the user's cursor is correct before any round
   * trip. The server recomputes authoritatively on save.
   */
  const totals = useMemo(
    () =>
      computeTotals({
        lines: lines.map((line) => ({
          id: line.key,
          quantity: line.quantity || '0',
          unitPrice: line.unitPrice || '0',
          vatRate: line.vatRate || '0',
          discount:
            line.discountKind && line.discountValue
              ? { kind: line.discountKind, value: line.discountValue }
              : null,
          isNote: line.isNote,
        })),
        globalDiscount:
          globalDiscountKind && globalDiscountValue
            ? { kind: globalDiscountKind, value: globalDiscountValue }
            : null,
        priceMode: document.priceMode,
      }),
    [lines, globalDiscountKind, globalDiscountValue, document.priceMode],
  );

  const lineTotals = new Map(totals.lines.map((line) => [line.id, line]));

  function update(key: string, patch: Partial<EditLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addVariant(variant: VariantSearchResult) {
    const key = `new-${crypto.randomUUID()}`;
    void resolveInto(key, variant.variantId, '1', currency);
    setLines((current) => [
      ...current,
      {
        key,
        variantId: variant.variantId,
        warehouseId: warehouseId || null,
        description: variant.productName,
        variantLabel: variant.variantLabel,
        sku: variant.sku,
        unitCode: variant.unitCode,
        quantity: '1',
        // Base price is in the company currency; the resolver replaces it momentarily.
        unitPrice: currency === companyCurrency ? (variant.sellingPrice ?? '0') : '0',
        vatRate: variant.vatRate,
        discountKind: null,
        discountValue: '',
        isNote: false,
        isService: variant.isService,
        available: variant.available,
        drawnQuantity: '0',
        sourceReference: null,
      },
    ]);
  }

  function addNote() {
    setLines((current) => [
      ...current,
      {
        key: `new-${crypto.randomUUID()}`,
        variantId: null,
        warehouseId: null,
        description: '',
        variantLabel: null,
        sku: null,
        unitCode: null,
        quantity: '0',
        unitPrice: '0',
        vatRate: '0',
        discountKind: null,
        discountValue: '',
        isNote: true,
        isService: false,
        available: null,
        drawnQuantity: '0',
        sourceReference: null,
      },
    ]);
  }

  function addFreeLine() {
    setLines((current) => [
      ...current,
      {
        key: `new-${crypto.randomUUID()}`,
        variantId: null,
        warehouseId: null,
        description: '',
        variantLabel: null,
        sku: null,
        unitCode: null,
        quantity: '1',
        unitPrice: '0',
        vatRate: '20',
        discountKind: null,
        discountValue: '',
        isNote: false,
        isService: true,
        available: null,
        drawnQuantity: '0',
        sourceReference: null,
      },
    ]);
  }

  // Inline validation: surfaced next to the offending field once the user has
  // tried to save, so a half-typed form is not shouted at.
  const lineErrors = new Map<string, { description?: string; quantity?: string }>();
  for (const line of lines) {
    if (line.isNote) continue;
    const problems: { description?: string; quantity?: string } = {};
    if (!line.description.trim()) problems.description = 'Désignation requise';
    if (!(Number(line.quantity) > 0)) problems.quantity = 'Qté > 0';
    if (problems.description || problems.quantity) lineErrors.set(line.key, problems);
  }
  const fieldErrors = {
    contact: contactId ? undefined : t('Sélectionnez un tiers'),
    due:
      dueDate && issueDate && dueDate < issueDate
        ? 'L’échéance précède la date du document'
        : undefined,
    valid:
      validUntil && issueDate && validUntil < issueDate
        ? 'La validité précède la date du document'
        : undefined,
  };
  const hasErrors =
    lineErrors.size > 0 || Boolean(fieldErrors.contact || fieldErrors.due || fieldErrors.valid);

  function submit() {
    setAttempted(true);
    if (hasErrors) {
      setError('Corrigez les champs signalés avant d’enregistrer.');
      return;
    }
    save.mutate();
  }

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await api.documents.update({
          params: { id: document.id },
          body: {
            contactId,
            issueDate,
            ...(currency !== document.currency ? { currency } : {}),
            dueDate: dueDate || null,
            validUntil: validUntil || null,
            warehouseId: warehouseId || null,
            reference: reference || null,
            projectName: projectName || null,
            notes: notes || null,
            terms: terms || null,
            returnToStock,
            globalDiscount:
              globalDiscountKind && globalDiscountValue
                ? { kind: globalDiscountKind, value: globalDiscountValue }
                : null,
            lines: lines.map((line, index) => ({
              ...(line.id ? { id: line.id } : {}),
              variantId: line.variantId,
              warehouseId: line.warehouseId ?? warehouseId ?? null,
              description: line.description,
              quantity: line.quantity || '0',
              unitPrice: line.unitPrice || '0',
              vatRate: line.vatRate || '0',
              discount:
                line.discountKind && line.discountValue
                  ? { kind: line.discountKind, value: line.discountValue }
                  : null,
              isNote: line.isNote,
              isService: line.isService,
              sortOrder: index + 1,
            })),
          },
        }),
      );
    },
    onSuccess: (updated) => {
      setLines(updated.lines.map(toEditLine));
      setAttempted(false);
      toast.success('Brouillon enregistré');
      void queryClient.invalidateQueries({ queryKey: ['document', document.id] });
      router.refresh();
    },
    onError: (cause) => {
      setError(cause instanceof ApiError ? cause.message : 'Enregistrement impossible');
    },
  });

  const showErr = <T,>(value: T | undefined) => (attempted ? value : undefined);
  const cancelHref = `/documents?type=${document.type}`;
  const LINE_GRID = '@3xl:grid-cols-[minmax(0,1fr)_5.5rem_6.5rem_8.5rem_4.5rem_6.5rem_2rem]';

  return (
    <div className="pb-24">
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader
              title={t('Tiers & dates')}
              description={t('{type} en brouillon', { type: documentTypeLabel(document.type) })}
            />
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label={t('Client / fournisseur')}
                required
                error={showErr(fieldErrors.contact)}
                className="sm:col-span-2 lg:col-span-1"
              >
                <Combobox
                  value={contactId}
                  selectedLabel={contactLabel}
                  placeholder={t('— Sélectionner —')}
                  searchPlaceholder={t('Nom, ICE, téléphone…')}
                  options={(contacts.data?.items ?? []).map((contact) => ({
                    value: contact.id,
                    label: contact.displayName,
                    description: [contact.ice, contact.phone].filter(Boolean).join(' · ') || undefined,
                  }))}
                  loading={contacts.isFetching}
                  onSearch={setContactSearch}
                  onChange={(value, option) => {
                    setContactId(value);
                    if (option) setContactLabel(option.label);
                  }}
                  onCreate={(query) => setCreatingContact(query)}
                  createLabel={(query) => t('Nouveau tiers « {q} »', { q: query })}
                />
                <ContactForm
                  open={creatingContact !== null}
                  onClose={() => setCreatingContact(null)}
                  defaultKind={contactKind}
                  initialName={creatingContact ?? ''}
                  onSaved={(saved) => {
                    setContactId(saved.id);
                    setContactLabel(saved.displayName);
                  }}
                />
              </Field>

              <Field label="Date">
                <Input
                  type="date"
                  value={issueDate}
                  onChange={(event) => setIssueDate(event.target.value)}
                />
              </Field>

              {typeMeta.hasDueDate && (
                <Field
                  label="Échéance"
                  hint="Déduite des conditions de paiement du tiers"
                  error={showErr(fieldErrors.due)}
                >
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </Field>
              )}

              {typeMeta.hasValidityDate && (
                <Field label="Valable jusqu’au" error={showErr(fieldErrors.valid)}>
                  <Input
                    type="date"
                    value={validUntil}
                    onChange={(event) => setValidUntil(event.target.value)}
                  />
                </Field>
              )}

              <Field label={t('Dépôt')} hint={t('Appliqué aux nouvelles lignes')}>
                <Combobox
                  value={warehouseId}
                  clearable
                  placeholder="—"
                  options={(warehouses.data ?? []).map((warehouse) => ({
                    value: warehouse.id,
                    label: `${warehouse.code} — ${warehouse.name}`,
                  }))}
                  onChange={(value) => setWarehouseId(value)}
                />
              </Field>

              <Field
                label={t('Devise')}
                hint={
                  currency === companyCurrency
                    ? undefined
                    : rateHint.data
                      ? `1 ${currency} = ${rateHint.data.rate} ${companyCurrency}`
                      : rateHint.isError
                        ? t('Aucun taux de change pour cette devise')
                        : undefined
                }
              >
                <Select value={currency} onChange={(event) => changeCurrency(event.target.value)}>
                  {currencyOptions.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Référence">
                <Input value={reference} onChange={(event) => setReference(event.target.value)} />
              </Field>

              <Field label="Projet">
                <Input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
              </Field>

              {document.type === 'CREDIT_NOTE' && (
                <div className="sm:col-span-2 lg:col-span-3">
                  {/* The single question that decides whether a credit note is a
                      money-only correction or a physical return. */}
                  <Checkbox
                    label="Les articles sont retournés en stock"
                    checked={returnToStock}
                    onChange={(event) => setReturnToStock(event.target.checked)}
                  />
                </div>
              )}
            </div>
          </Card>

          <Card className="@container">
            <CardHeader
              title="Lignes"
              description="Tapez une référence, un nom ou scannez un code-barres"
            />

            <div className="border-b border-border p-4">
              <VariantPicker
                warehouseId={warehouseId || null}
                onPick={addVariant}
                autoFocus={typeof window !== 'undefined' && window.innerWidth >= 1024}
              />
            </div>

            {lines.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
                <span className="mb-2 flex size-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                  <Icon name="box" className="size-5" />
                </span>
                <p className="text-sm font-semibold text-ink">Aucune ligne</p>
                <p className="text-sm text-ink-muted">
                  Recherchez un article ci-dessus ou ajoutez une ligne libre.
                </p>
              </div>
            ) : (
              <div>
                <div
                  className={clsx(
                    'hidden gap-3 border-b border-border bg-surface-muted/60 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted @3xl:grid',
                    LINE_GRID,
                  )}
                >
                  <span>Désignation</span>
                  <span className="text-end">Qté</span>
                  <span className="text-end">P.U. HT</span>
                  <span>Remise</span>
                  <span className="text-end">TVA %</span>
                  <span className="text-end">Total HT</span>
                  <span />
                </div>

                <ul className="divide-y divide-border/70">
                  {lines.map((line, index) => {
                    const computed = lineTotals.get(line.key);
                    const errs = attempted ? lineErrors.get(line.key) : undefined;
                    const short =
                      !line.isNote &&
                      !line.isService &&
                      line.available !== null &&
                      Number(line.quantity) > Number(line.available);
                    const remove = () => setLines((c) => c.filter((l) => l.key !== line.key));

                    if (line.isNote) {
                      return (
                        <li
                          key={line.key}
                          className="flex items-center gap-2 bg-surface-muted/50 px-4 py-3"
                        >
                          <Icon name="menu" className="text-ink-subtle" />
                          <Input
                            value={line.description}
                            placeholder="Titre de section ou commentaire"
                            onChange={(event) =>
                              update(line.key, { description: event.target.value })
                            }
                            className="font-medium"
                          />
                          <RemoveButton onClick={remove} />
                        </li>
                      );
                    }

                    return (
                      <li
                        key={line.key}
                        className={clsx(
                          'grid grid-cols-2 gap-3 px-4 py-4 @3xl:items-start',
                          LINE_GRID,
                        )}
                      >
                        <div className="col-span-2 min-w-0 @3xl:col-span-1">
                          <div className="flex items-start gap-2">
                            <span className="mt-2 w-5 shrink-0 text-xs tabular text-ink-subtle">
                              {index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <Input
                                value={line.description}
                                aria-label="Désignation"
                                placeholder="Désignation"
                                className={errs?.description ? 'border-danger' : undefined}
                                onChange={(event) =>
                                  update(line.key, { description: event.target.value })
                                }
                              />
                              {errs?.description && (
                                <p className="mt-1 text-xs text-danger">{errs.description}</p>
                              )}
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-subtle">
                                {line.sku && <span>{line.sku}</span>}
                                {line.variantLabel && <span>· {line.variantLabel}</span>}
                                {line.sourceReference && (
                                  <span className="text-brand">
                                    · issue de {line.sourceReference}
                                  </span>
                                )}
                                {line.available !== null && !line.isService && (
                                  <span className={short ? 'font-medium text-danger' : ''}>
                                    · dispo {amount(line.available)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <span className="@3xl:hidden">
                              <RemoveButton onClick={remove} />
                            </span>
                          </div>
                        </div>

                        <LineCell label="Qté">
                          <NumberInput
                            value={line.quantity}
                            aria-label="Quantité"
                            onChange={(event) => update(line.key, { quantity: event.target.value })}
                            className={short || errs?.quantity ? 'border-danger' : undefined}
                          />
                          {errs?.quantity && (
                            <p className="mt-1 text-end text-xs text-danger">{errs.quantity}</p>
                          )}
                          {Number(line.drawnQuantity) > 0 && (
                            <p className="mt-1 text-end text-[11px] text-ink-subtle">
                              {amount(line.drawnQuantity)} déjà utilisée(s)
                            </p>
                          )}
                        </LineCell>

                        <LineCell label="P.U. HT">
                          <NumberInput
                            value={line.unitPrice}
                            aria-label="Prix unitaire HT"
                            onChange={(event) =>
                              update(line.key, { unitPrice: event.target.value, priceTouched: true })
                            }
                          />
                        </LineCell>

                        <LineCell label="Remise">
                          <div className="flex gap-1.5">
                            <NumberInput
                              value={line.discountValue}
                              placeholder="0"
                              aria-label="Remise"
                              onChange={(event) =>
                                update(line.key, {
                                  discountValue: event.target.value,
                                  discountKind: line.discountKind ?? 'PERCENT',
                                })
                              }
                              className="min-w-0"
                            />
                            <UnitSwitch
                              value={line.discountKind ?? 'PERCENT'}
                              onChange={(kind) => update(line.key, { discountKind: kind })}
                            />
                          </div>
                        </LineCell>

                        <LineCell label="TVA %">
                          <NumberInput
                            value={line.vatRate}
                            aria-label="TVA en pourcentage"
                            onChange={(event) => update(line.key, { vatRate: event.target.value })}
                          />
                        </LineCell>

                        <div className="col-span-2 flex items-center justify-between @3xl:col-span-1 @3xl:block @3xl:pt-2 @3xl:text-end">
                          <span className="text-xs font-medium text-ink-muted @3xl:hidden">
                            Total HT
                          </span>
                          <span className="tabular text-sm font-semibold text-ink">
                            {computed ? money(computed.taxableBase, currency) : '—'}
                          </span>
                        </div>

                        <div className="hidden @3xl:block">
                          <RemoveButton onClick={remove} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-border bg-surface-muted/40 px-4 py-3 rounded-b-card">
              <Button size="sm" variant="secondary" onClick={addFreeLine}>
                <Icon name="plus" />
                Ajouter une ligne
              </Button>
              <Button size="sm" variant="ghost" onClick={addNote}>
                <Icon name="plus" />
                Ligne de texte
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Notes" description="Imprimées sur le document" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Observations">
                <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
              <Field label="Conditions générales">
                <Textarea value={terms} onChange={(event) => setTerms(event.target.value)} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader title="Totaux" description="Calculés en direct" />
            <div className="space-y-2 p-5 text-sm">
              <Row label="Sous-total" value={money(totals.subtotalGross, currency)} />
              {totals.totalLineDiscounts !== '0.00' && (
                <Row
                  label="Remises lignes"
                  value={`− ${money(totals.totalLineDiscounts, currency)}`}
                />
              )}

              <div className="flex items-center gap-2 py-1">
                <span className="flex-1 whitespace-nowrap text-ink-muted">Remise globale</span>
                <NumberInput
                  value={globalDiscountValue}
                  placeholder="0"
                  aria-label="Remise globale"
                  onChange={(event) => {
                    setGlobalDiscountValue(event.target.value);
                    if (!globalDiscountKind) setGlobalDiscountKind('PERCENT');
                  }}
                  className="w-16"
                />
                <UnitSwitch
                  value={globalDiscountKind || 'PERCENT'}
                  onChange={setGlobalDiscountKind}
                />
              </div>

              {totals.globalDiscount !== '0.00' && (
                <Row label="Montant remise" value={`− ${money(totals.globalDiscount, currency)}`} />
              )}

              <div className="my-2 border-t border-border" />
              <Row label="Total HT" value={money(totals.totalExclVat, currency)} strong />

              {totals.vatBuckets.map((bucket) => (
                <Row
                  key={bucket.rate}
                  label={`TVA ${percent(bucket.rate)} sur ${money(bucket.base, currency)}`}
                  value={money(bucket.amount, currency)}
                  small
                />
              ))}

              <Row label="Total TVA" value={money(totals.totalVat, currency)} />
            </div>
            <div className="flex items-baseline justify-between gap-3 rounded-b-card border-t border-border bg-surface-muted/50 px-5 py-4">
              <span className="text-sm font-semibold text-ink">Total TTC</span>
              <span className="tabular text-2xl font-semibold tracking-tight text-ink">
                {money(totals.totalInclVat, currency)}
              </span>
            </div>
          </Card>
          <p className="px-1 text-xs text-ink-subtle">
            Les totaux sont recalculés par le serveur à l’enregistrement.
          </p>
        </div>
      </div>

      {/* Always-reachable actions. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur lg:start-65">
        <div className="mx-auto flex w-full max-w-350 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 lg:px-8">
          <div className="min-w-0 flex-1">
            {error ? (
              <p className="flex items-center gap-1.5 text-sm text-danger" role="alert">
                <Icon name="alert" />
                <span className="truncate">{error}</span>
              </p>
            ) : (
              <p className="hidden whitespace-nowrap text-sm text-ink-muted sm:block">
                Total TTC{' '}
                <span className="tabular font-semibold text-ink">
                  {money(totals.totalInclVat, currency)}
                </span>
              </p>
            )}
          </div>
          <Button variant="secondary" onClick={() => router.push(cancelHref)}>
            Annuler
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            <Icon name="check" />
            Enregistrer<span className="hidden sm:inline"> le brouillon</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function LineCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-xs font-medium text-ink-muted @3xl:hidden">{label}</span>
      {children}
    </div>
  );
}

/** Compact "% / DH" switch, so a discount kind is one tap rather than a dropdown. */
function UnitSwitch({
  value,
  onChange,
}: {
  value: 'PERCENT' | 'AMOUNT';
  onChange: (value: 'PERCENT' | 'AMOUNT') => void;
}) {
  return (
    <div className="inline-flex h-9 shrink-0 rounded-lg bg-surface-muted p-0.5" role="group">
      {(['PERCENT', 'AMOUNT'] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          aria-pressed={value === kind}
          onClick={() => onChange(kind)}
          className={clsx(
            'rounded-md px-2 text-xs font-medium transition',
            value === kind ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
          )}
        >
          {kind === 'PERCENT' ? '%' : 'DH'}
        </button>
      ))}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  small,
}: {
  label: string;
  value: string;
  strong?: boolean;
  small?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${small ? 'text-xs' : ''}`}>
      <span className="text-ink-muted">{label}</span>
      <span className={clsx('tabular text-ink', strong && 'font-medium')}>{value}</span>
    </div>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton
      label="Supprimer la ligne"
      onClick={onClick}
      className="hover:bg-danger-soft hover:text-danger"
    >
      <Icon name="x" />
    </IconButton>
  );
}
