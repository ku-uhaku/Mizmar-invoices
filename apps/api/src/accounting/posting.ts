import { createHash } from 'node:crypto';
import { dec } from '@mizmar/core';
import { EXPENSE_ROLE } from './chart';

export interface DraftLine {
  /** Account role, resolved to the company's account when posting. */
  role: string;
  debit: string;
  credit: string;
  label?: string;
}

export interface Draft {
  /** Idempotency base: one live entry per base. */
  base: string;
  source: 'DOCUMENT' | 'PAYMENT' | 'EXPENSE' | 'EXPENSE_PAYMENT' | 'OPENING';
  date: string;
  label: string;
  lines: DraftLine[];
}

const money = (value: string | number | ReturnType<typeof dec>) => dec(value.toString()).toFixed(2);

/** A debit or credit line; a negative amount flips the side. */
function line(role: string, side: 'debit' | 'credit', amount: string, label?: string): DraftLine | null {
  const value = dec(amount);
  if (value.isZero()) return null;
  const flipped = value.isNegative();
  const debit = (side === 'debit') !== flipped;
  const abs = value.abs().toFixed(2);
  return { role, debit: debit ? abs : '0.00', credit: debit ? '0.00' : abs, label };
}

const compact = (lines: Array<DraftLine | null>) => lines.filter((entry): entry is DraftLine => entry !== null);

export function isBalanced(lines: DraftLine[]): boolean {
  const debit = lines.reduce((sum, entry) => sum.plus(entry.debit), dec(0));
  const credit = lines.reduce((sum, entry) => sum.plus(entry.credit), dec(0));
  return debit.eq(credit) && debit.gt(0);
}

export function reverseLines(lines: DraftLine[]): DraftLine[] {
  return lines.map((entry) => ({ ...entry, debit: entry.credit, credit: entry.debit }));
}

export function fingerprint(date: string, lines: Array<{ code: string; debit: string; credit: string }>): string {
  return createHash('sha1')
    .update(JSON.stringify([date, lines.map((entry) => [entry.code, money(entry.debit), money(entry.credit)])]))
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface DocumentFacts {
  id: string;
  type: 'SALES_INVOICE' | 'CREDIT_NOTE' | 'PURCHASE_INVOICE';
  number: string | null;
  contactName: string;
  date: string;
  /** Company-currency amounts (document currency already converted). */
  exclVat: string;
  vat: string;
  inclVat: string;
}

/** Sales invoice: Dr clients, Cr ventes + TVA facturée. Credit notes mirror it. */
export function documentDraft(facts: DocumentFacts): Draft | null {
  // Totals may be stored signed (credit notes); direction comes from the type.
  const incl = dec(facts.inclVat).abs().toFixed(2);
  const vat = dec(facts.vat).abs().toFixed(2);
  const excl = dec(incl).minus(vat).toFixed(2);
  const label = `${facts.number ?? facts.type} — ${facts.contactName}`;
  const base = `DOC:${facts.id}`;

  let lines: Array<DraftLine | null>;
  if (facts.type === 'SALES_INVOICE') {
    lines = [line('RECEIVABLE', 'debit', incl, facts.contactName), line('SALES', 'credit', excl), line('VAT_COLLECTED', 'credit', vat)];
  } else if (facts.type === 'CREDIT_NOTE') {
    lines = [line('SALES', 'debit', excl), line('VAT_COLLECTED', 'debit', vat), line('RECEIVABLE', 'credit', incl, facts.contactName)];
  } else {
    lines = [line('PURCHASES', 'debit', excl), line('VAT_DEDUCTIBLE', 'debit', vat), line('PAYABLE', 'credit', incl, facts.contactName)];
  }
  const result = compact(lines);
  return isBalanced(result) ? { base, source: 'DOCUMENT', date: facts.date, label, lines: result } : null;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export interface PaymentFacts {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  /** Cheque / bill: sits in a holding account until the bank clears it. */
  deferred: boolean;
  status: 'PENDING' | 'DEPOSITED' | 'CLEARED' | 'BOUNCED' | 'CANCELLED';
  cashMethod: boolean;
  amount: string;
  paidAt: string;
  clearedAt: string | null;
  contactName: string;
  reference: string | null;
}

/**
 * Money received or paid. Cash and transfers hit cash/bank at once. A cheque
 * first sits with the customer/supplier in a holding account and moves to the
 * bank when cleared. Bounced and cancelled payments post nothing.
 */
export function paymentDrafts(facts: PaymentFacts): Draft[] {
  if (facts.status === 'BOUNCED' || facts.status === 'CANCELLED') return [];
  const amount = money(dec(facts.amount).abs());
  const inbound = facts.direction === 'INBOUND';
  const tiers = inbound ? 'RECEIVABLE' : 'PAYABLE';
  const label = `${inbound ? 'Encaissement' : 'Règlement'} ${facts.reference ?? ''} — ${facts.contactName}`.replace(/\s+/g, ' ').trim();
  const money_ = facts.cashMethod ? 'CASH' : 'BANK';

  const post = (base: string, date: string, from: string, to: string, text: string): Draft => ({
    base,
    source: 'PAYMENT',
    date,
    label: text,
    lines: compact([line(from, 'debit', amount), line(to, 'credit', amount)]),
  });

  if (!facts.deferred) {
    return [
      inbound
        ? post(`PAY:${facts.id}`, facts.paidAt, money_, tiers, label)
        : post(`PAY:${facts.id}`, facts.paidAt, tiers, money_, label),
    ];
  }

  const holding = inbound ? 'CHEQUES_IN' : 'CHEQUES_OUT';
  const drafts = [
    inbound
      ? post(`PAY:${facts.id}:held`, facts.paidAt, holding, tiers, label)
      : post(`PAY:${facts.id}:held`, facts.paidAt, tiers, holding, label),
  ];
  if (facts.status === 'CLEARED') {
    const date = facts.clearedAt ?? facts.paidAt;
    drafts.push(
      inbound
        ? post(`PAY:${facts.id}:cleared`, date, money_, holding, `${label} (encaissé)`)
        : post(`PAY:${facts.id}:cleared`, date, holding, money_, `${label} (débité)`),
    );
  }
  return drafts;
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export interface ExpenseFacts {
  id: string;
  categoryKind: string;
  label: string;
  date: string;
  exclVat: string;
  vat: string;
  inclVat: string;
}

export function expenseDraft(facts: ExpenseFacts): Draft | null {
  const incl = dec(facts.inclVat).abs().toFixed(2);
  const vat = dec(facts.vat).abs().toFixed(2);
  const excl = dec(incl).minus(vat).toFixed(2);
  const lines = compact([
    line(EXPENSE_ROLE[facts.categoryKind] ?? 'EXP_OTHER', 'debit', excl),
    line('VAT_DEDUCTIBLE', 'debit', vat),
    line('PAYABLE', 'credit', incl),
  ]);
  return isBalanced(lines)
    ? { base: `EXP:${facts.id}`, source: 'EXPENSE', date: facts.date, label: facts.label, lines }
    : null;
}

export function expensePaymentDraft(facts: {
  id: string;
  label: string;
  date: string;
  amount: string;
  cashMethod: boolean;
}): Draft | null {
  const amount = money(dec(facts.amount).abs());
  const lines = compact([line('PAYABLE', 'debit', amount), line(facts.cashMethod ? 'CASH' : 'BANK', 'credit', amount)]);
  return isBalanced(lines)
    ? { base: `EXPPAY:${facts.id}`, source: 'EXPENSE_PAYMENT', date: facts.date, label: `Règlement — ${facts.label}`, lines }
    : null;
}

// ---------------------------------------------------------------------------
// Opening balances
// ---------------------------------------------------------------------------

/**
 * A debt carried over from before the app: it enters the books against
 * "report à nouveau". Positive is in the contact's natural direction (client
 * owes you / you owe the supplier); a negative amount flips both lines.
 */
export function openingDraft(facts: {
  id: string;
  supplier: boolean;
  contactName: string;
  date: string;
  amount: string;
}): Draft | null {
  const amount = dec(facts.amount).toFixed(2);
  const label = `Solde d’ouverture — ${facts.contactName}`;
  const lines = compact(
    facts.supplier
      ? [line('OPENING', 'debit', amount), line('PAYABLE', 'credit', amount, facts.contactName)]
      : [line('RECEIVABLE', 'debit', amount, facts.contactName), line('OPENING', 'credit', amount)],
  );
  return isBalanced(lines) ? { base: `OPEN:${facts.id}`, source: 'OPENING', date: facts.date, label, lines } : null;
}
