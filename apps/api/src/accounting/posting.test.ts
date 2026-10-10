import { describe, expect, it } from 'vitest';
import {
  documentDraft,
  expenseDraft,
  expensePaymentDraft,
  fingerprint,
  isBalanced,
  openingDraft,
  paymentDrafts,
  reverseLines,
  type PaymentFacts,
} from './posting';

const sum = (lines: Array<{ debit: string; credit: string }>, side: 'debit' | 'credit') =>
  lines.reduce((acc, entry) => acc + Number(entry[side]), 0);

describe('documentDraft', () => {
  const base = { id: 'd1', number: 'FA-1', contactName: 'Atlas', date: '2026-10-01', exclVat: '1000.00', vat: '200.00', inclVat: '1200.00' };

  it('posts a sales invoice to clients, sales and VAT', () => {
    const draft = documentDraft({ ...base, type: 'SALES_INVOICE' })!;
    expect(isBalanced(draft.lines)).toBe(true);
    expect(draft.lines.find((l) => l.role === 'RECEIVABLE')?.debit).toBe('1200.00');
    expect(draft.lines.find((l) => l.role === 'SALES')?.credit).toBe('1000.00');
    expect(draft.lines.find((l) => l.role === 'VAT_COLLECTED')?.credit).toBe('200.00');
  });

  it('derives the net from the total so rounding never unbalances an entry', () => {
    const draft = documentDraft({ ...base, type: 'SALES_INVOICE', exclVat: '999.99', vat: '200.00', inclVat: '1200.00' })!;
    expect(isBalanced(draft.lines)).toBe(true);
  });

  it('mirrors a credit note, whatever the stored sign', () => {
    const draft = documentDraft({ ...base, type: 'CREDIT_NOTE', exclVat: '-1000.00', vat: '-200.00', inclVat: '-1200.00' })!;
    expect(draft.lines.find((l) => l.role === 'RECEIVABLE')?.credit).toBe('1200.00');
    expect(draft.lines.find((l) => l.role === 'SALES')?.debit).toBe('1000.00');
  });

  it('posts a purchase invoice to purchases, deductible VAT and suppliers', () => {
    const draft = documentDraft({ ...base, type: 'PURCHASE_INVOICE' })!;
    expect(draft.lines.find((l) => l.role === 'PAYABLE')?.credit).toBe('1200.00');
    expect(draft.lines.find((l) => l.role === 'VAT_DEDUCTIBLE')?.debit).toBe('200.00');
  });

  it('omits a zero VAT line', () => {
    const draft = documentDraft({ ...base, type: 'SALES_INVOICE', vat: '0', inclVat: '1000.00' })!;
    expect(draft.lines.map((l) => l.role)).toEqual(['RECEIVABLE', 'SALES']);
  });

  it('posts nothing for a zero document', () => {
    expect(documentDraft({ ...base, type: 'SALES_INVOICE', exclVat: '0', vat: '0', inclVat: '0' })).toBeNull();
  });
});

describe('paymentDrafts', () => {
  const facts: PaymentFacts = {
    id: 'p1', direction: 'INBOUND', deferred: false, status: 'CLEARED', cashMethod: false,
    amount: '500.00', paidAt: '2026-10-02', clearedAt: null, contactName: 'Atlas', reference: 'VIR-1',
  };

  it('puts a transfer straight in the bank', () => {
    const [draft] = paymentDrafts(facts);
    expect(draft!.lines.map((l) => [l.role, l.debit, l.credit])).toEqual([
      ['BANK', '500.00', '0.00'],
      ['RECEIVABLE', '0.00', '500.00'],
    ]);
  });

  it('uses the cash account for cash', () => {
    expect(paymentDrafts({ ...facts, cashMethod: true })[0]!.lines[0]!.role).toBe('CASH');
  });

  it('holds a pending cheque, then moves it to the bank when cleared', () => {
    const pending = paymentDrafts({ ...facts, deferred: true, status: 'PENDING' });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.lines[0]!.role).toBe('CHEQUES_IN');

    const cleared = paymentDrafts({ ...facts, deferred: true, status: 'CLEARED', clearedAt: '2026-10-09' });
    expect(cleared.map((d) => d.base)).toEqual(['PAY:p1:held', 'PAY:p1:cleared']);
    expect(cleared[1]!.date).toBe('2026-10-09');
    expect(cleared[1]!.lines.map((l) => l.role)).toEqual(['BANK', 'CHEQUES_IN']);
  });

  it('posts nothing for bounced or cancelled payments', () => {
    expect(paymentDrafts({ ...facts, deferred: true, status: 'BOUNCED' })).toEqual([]);
    expect(paymentDrafts({ ...facts, status: 'CANCELLED' })).toEqual([]);
  });

  it('reverses direction for supplier payments', () => {
    const [draft] = paymentDrafts({ ...facts, direction: 'OUTBOUND' });
    expect(draft!.lines.map((l) => [l.role, l.debit, l.credit])).toEqual([
      ['PAYABLE', '500.00', '0.00'],
      ['BANK', '0.00', '500.00'],
    ]);
  });
});

describe('expenses', () => {
  it('posts a bill to its category account and deductible VAT', () => {
    const draft = expenseDraft({ id: 'e1', categoryKind: 'RENT', label: 'Loyer', date: '2026-10-01', exclVat: '5000', vat: '0', inclVat: '5000' })!;
    expect(draft.lines.map((l) => l.role)).toEqual(['EXP_RENT', 'PAYABLE']);
  });
  it('falls back to other charges for unknown kinds', () => {
    const draft = expenseDraft({ id: 'e1', categoryKind: 'WHAT', label: 'x', date: '2026-10-01', exclVat: '10', vat: '2', inclVat: '12' })!;
    expect(draft.lines[0]!.role).toBe('EXP_OTHER');
  });
  it('pays a bill from the bank or the till', () => {
    const draft = expensePaymentDraft({ id: 'x', label: 'Loyer', date: '2026-10-05', amount: '5000', cashMethod: true })!;
    expect(draft.lines.map((l) => l.role)).toEqual(['PAYABLE', 'CASH']);
  });
});

describe('helpers', () => {
  it('reverses a draft by swapping sides', () => {
    const lines = documentDraft({ id: 'd', type: 'SALES_INVOICE', number: null, contactName: 'A', date: '2026-10-01', exclVat: '10', vat: '2', inclVat: '12' })!.lines;
    const back = reverseLines(lines);
    expect(sum(back, 'debit')).toBe(sum(lines, 'credit'));
    expect(isBalanced(back)).toBe(true);
  });
  it('fingerprints change with amounts or date', () => {
    const a = fingerprint('2026-10-01', [{ code: '3421', debit: '10', credit: '0' }]);
    expect(a).toBe(fingerprint('2026-10-01', [{ code: '3421', debit: '10.00', credit: '0.00' }]));
    expect(a).not.toBe(fingerprint('2026-10-02', [{ code: '3421', debit: '10', credit: '0' }]));
    expect(a).not.toBe(fingerprint('2026-10-01', [{ code: '3421', debit: '11', credit: '0' }]));
  });
});

describe('openingDraft', () => {
  const base = { id: 'o1', contactName: 'Atlas', date: '2026-01-01' };

  it('a client who owes you debits clients against report à nouveau', () => {
    const draft = openingDraft({ ...base, supplier: false, amount: '5000' })!;
    expect(isBalanced(draft.lines)).toBe(true);
    expect(draft.lines.find((l) => l.role === 'RECEIVABLE')?.debit).toBe('5000.00');
    expect(draft.lines.find((l) => l.role === 'OPENING')?.credit).toBe('5000.00');
  });
  it('a supplier you owe credits suppliers', () => {
    const draft = openingDraft({ ...base, supplier: true, amount: '800' })!;
    expect(draft.lines.find((l) => l.role === 'PAYABLE')?.credit).toBe('800.00');
    expect(draft.lines.find((l) => l.role === 'OPENING')?.debit).toBe('800.00');
  });
  it('an advance (negative) flips both sides', () => {
    const draft = openingDraft({ ...base, supplier: false, amount: '-300' })!;
    expect(draft.lines.find((l) => l.role === 'RECEIVABLE')?.credit).toBe('300.00');
    expect(draft.lines.find((l) => l.role === 'OPENING')?.debit).toBe('300.00');
  });
  it('posts nothing for zero', () => {
    expect(openingDraft({ ...base, supplier: false, amount: '0' })).toBeNull();
  });
});
