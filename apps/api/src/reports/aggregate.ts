import { dec, type Decimal } from '@mizmar/core';
import { moneyOut, qtyOut } from '../common/util/decimal';

// ---------------------------------------------------------------------------
// Sales grouping
// ---------------------------------------------------------------------------

export interface SalesFact {
  /** Group key (period, contact id, variant id...). */
  key: string;
  label: string;
  documentId: string;
  /** +1 for invoices, -1 for credit notes, so credit notes net off. */
  sign: 1 | -1;
  exclVat: string;
  vat: string;
  inclVat: string;
  quantity?: string | null;
}

export interface SalesGroupRow {
  key: string;
  label: string;
  documentCount: number;
  quantity: string | null;
  totalExclVat: string;
  totalVat: string;
  totalInclVat: string;
}

/** Sum facts per key, signed, in key order. Magnitudes are taken as absolute values. */
export function groupSales(facts: SalesFact[]): {
  rows: SalesGroupRow[];
  totals: { totalExclVat: string; totalVat: string; totalInclVat: string };
} {
  const groups = new Map<
    string,
    { label: string; docs: Set<string>; excl: Decimal; vat: Decimal; incl: Decimal; qty: Decimal | null }
  >();
  let excl = dec(0);
  let vat = dec(0);
  let incl = dec(0);

  for (const fact of facts) {
    const sign = fact.sign;
    const e = dec(fact.exclVat).abs().times(sign);
    const v = dec(fact.vat).abs().times(sign);
    const i = dec(fact.inclVat).abs().times(sign);

    let group = groups.get(fact.key);
    if (!group) {
      group = { label: fact.label, docs: new Set(), excl: dec(0), vat: dec(0), incl: dec(0), qty: null };
      groups.set(fact.key, group);
    }
    group.docs.add(fact.documentId);
    group.excl = group.excl.plus(e);
    group.vat = group.vat.plus(v);
    group.incl = group.incl.plus(i);
    if (fact.quantity !== undefined && fact.quantity !== null) {
      group.qty = (group.qty ?? dec(0)).plus(dec(fact.quantity).abs().times(sign));
    }
    excl = excl.plus(e);
    vat = vat.plus(v);
    incl = incl.plus(i);
  }

  const rows = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, g]) => ({
      key,
      label: g.label,
      documentCount: g.docs.size,
      quantity: g.qty ? qtyOut(g.qty) : null,
      totalExclVat: moneyOut(g.excl),
      totalVat: moneyOut(g.vat),
      totalInclVat: moneyOut(g.incl),
    }));

  return {
    rows,
    totals: { totalExclVat: moneyOut(excl), totalVat: moneyOut(vat), totalInclVat: moneyOut(incl) },
  };
}

// ---------------------------------------------------------------------------
// VAT summary
// ---------------------------------------------------------------------------

export interface VatDocument {
  sign: 1 | -1;
  buckets: Array<{ rate: string | number; base: string | number; amount: string | number }>;
}

export interface VatSide {
  rows: Array<{ rate: string; base: string; vat: string }>;
  totalBase: string;
  totalVat: string;
}

/** Taxable base and VAT per rate, credit notes subtracted. */
export function aggregateVat(documents: VatDocument[]): VatSide {
  const perRate = new Map<string, { rate: Decimal; base: Decimal; vat: Decimal }>();
  let totalBase = dec(0);
  let totalVat = dec(0);

  for (const document of documents) {
    for (const bucket of document.buckets) {
      const rate = dec(bucket.rate);
      const key = rate.toFixed(2);
      const base = dec(bucket.base).abs().times(document.sign);
      const vat = dec(bucket.amount).abs().times(document.sign);

      const entry = perRate.get(key) ?? { rate, base: dec(0), vat: dec(0) };
      entry.base = entry.base.plus(base);
      entry.vat = entry.vat.plus(vat);
      perRate.set(key, entry);
      totalBase = totalBase.plus(base);
      totalVat = totalVat.plus(vat);
    }
  }

  const rows = [...perRate.values()]
    .sort((a, b) => a.rate.comparedTo(b.rate))
    .map((entry) => ({
      rate: entry.rate.toFixed(2),
      base: moneyOut(entry.base),
      vat: moneyOut(entry.vat),
    }));

  return { rows, totalBase: moneyOut(totalBase), totalVat: moneyOut(totalVat) };
}

// ---------------------------------------------------------------------------
// Account statement
// ---------------------------------------------------------------------------

export interface StatementEntry {
  date: string; // YYYY-MM-DD
  kind: 'DOCUMENT' | 'PAYMENT';
  reference: string;
  label: string;
  /** Amount that increases the running balance. */
  debit: string;
  /** Amount that decreases the running balance. */
  credit: string;
}

export interface StatementRowOut extends StatementEntry {
  balance: string;
}

/**
 * Fold everything before `from` into an opening balance and attach a running
 * balance to what remains. Entries must be sorted by date.
 */
export function buildStatementRows(entries: StatementEntry[], from: string) {
  let opening = dec(0);
  let running = dec(0);
  let totalDebit = dec(0);
  let totalCredit = dec(0);
  const rows: StatementRowOut[] = [];

  for (const entry of entries) {
    const delta = dec(entry.debit).minus(dec(entry.credit));
    if (entry.date < from) {
      opening = opening.plus(delta);
      running = running.plus(delta);
      continue;
    }
    running = running.plus(delta);
    totalDebit = totalDebit.plus(dec(entry.debit));
    totalCredit = totalCredit.plus(dec(entry.credit));
    rows.push({ ...entry, balance: moneyOut(running) });
  }

  return {
    openingBalance: moneyOut(opening),
    closingBalance: moneyOut(running),
    totalDebit: moneyOut(totalDebit),
    totalCredit: moneyOut(totalCredit),
    rows,
  };
}
