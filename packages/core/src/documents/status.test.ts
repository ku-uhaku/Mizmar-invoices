import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  computeFulfilment,
  computeSettlement,
  documentBadges,
  IllegalTransitionError,
  isEditable,
  isOverdue,
  outstandingAmount,
} from './status';
import { LIFECYCLE_STATES, type Lifecycle } from './types';

describe('lifecycle transitions', () => {
  it('allows the forward path', () => {
    expect(canTransition('DRAFT', 'VALIDATED')).toBe(true);
    expect(canTransition('VALIDATED', 'SENT')).toBe(true);
  });

  it('allows cancelling from anything but cancelled', () => {
    expect(canTransition('DRAFT', 'CANCELLED')).toBe(true);
    expect(canTransition('VALIDATED', 'CANCELLED')).toBe(true);
    expect(canTransition('SENT', 'CANCELLED')).toBe(true);
    expect(canTransition('CANCELLED', 'CANCELLED')).toBe(false);
  });

  it('never reopens a validated document', () => {
    expect(canTransition('VALIDATED', 'DRAFT')).toBe(false);
    expect(canTransition('SENT', 'DRAFT')).toBe(false);
    expect(canTransition('SENT', 'VALIDATED')).toBe(false);
  });

  it('never revives a cancelled document', () => {
    for (const to of LIFECYCLE_STATES) {
      expect(canTransition('CANCELLED', to)).toBe(false);
    }
  });

  it('rejects self-transitions', () => {
    for (const state of LIFECYCLE_STATES) {
      expect(canTransition(state, state)).toBe(false);
    }
  });

  it('throws a typed error on an illegal move', () => {
    expect(() => assertTransition('VALIDATED', 'DRAFT')).toThrow(IllegalTransitionError);
    expect(() => assertTransition('DRAFT', 'VALIDATED')).not.toThrow();
  });

  it('only a draft is editable', () => {
    const editable = LIFECYCLE_STATES.filter((s: Lifecycle) => isEditable(s));
    expect(editable).toEqual(['DRAFT']);
  });
});

describe('computeFulfilment', () => {
  it('is pending when nothing has been drawn', () => {
    expect(computeFulfilment('SALES_ORDER', [{ quantity: '10', drawnQuantity: '0' }])).toBe('PENDING');
  });

  it('is partial when some has been drawn', () => {
    expect(computeFulfilment('SALES_ORDER', [{ quantity: '10', drawnQuantity: '4' }])).toBe('PARTIAL');
  });

  it('is complete only when every line is fully drawn', () => {
    expect(
      computeFulfilment('SALES_ORDER', [
        { quantity: '10', drawnQuantity: '10' },
        { quantity: '5', drawnQuantity: '5' },
      ]),
    ).toBe('COMPLETE');

    expect(
      computeFulfilment('SALES_ORDER', [
        { quantity: '10', drawnQuantity: '10' },
        { quantity: '5', drawnQuantity: '4' },
      ]),
    ).toBe('PARTIAL');
  });

  it('treats over-drawing as complete rather than breaking', () => {
    expect(computeFulfilment('SALES_ORDER', [{ quantity: '10', drawnQuantity: '12' }])).toBe('COMPLETE');
  });

  it('does not apply to terminal document types', () => {
    expect(computeFulfilment('CREDIT_NOTE', [{ quantity: '1', drawnQuantity: '0' }])).toBe('NOT_APPLICABLE');
    expect(computeFulfilment('PURCHASE_INVOICE', [{ quantity: '1', drawnQuantity: '0' }])).toBe('NOT_APPLICABLE');
  });

  it('is not applicable when there is nothing billable', () => {
    expect(computeFulfilment('SALES_ORDER', [])).toBe('NOT_APPLICABLE');
  });
});

describe('computeSettlement', () => {
  it('does not apply to documents that do not settle', () => {
    expect(computeSettlement('DEVIS', '1000', '0')).toBe('NOT_APPLICABLE');
    expect(computeSettlement('DELIVERY_NOTE', '1000', '0')).toBe('NOT_APPLICABLE');
  });

  it('walks unpaid -> partial -> paid', () => {
    expect(computeSettlement('SALES_INVOICE', '1200', '0')).toBe('UNPAID');
    expect(computeSettlement('SALES_INVOICE', '1200', '500')).toBe('PARTIAL');
    expect(computeSettlement('SALES_INVOICE', '1200', '1200')).toBe('PAID');
  });

  it('treats an overpayment as paid', () => {
    expect(computeSettlement('SALES_INVOICE', '1200', '1500')).toBe('PAID');
  });

  it('compares magnitudes, so a credit note settles correctly', () => {
    expect(computeSettlement('CREDIT_NOTE', '-600', '-600')).toBe('PAID');
    expect(computeSettlement('CREDIT_NOTE', '-600', '-100')).toBe('PARTIAL');
  });

  it('calls a zero-total document paid', () => {
    expect(computeSettlement('SALES_INVOICE', '0', '0')).toBe('PAID');
  });

  it('reports what is still owed, never a negative', () => {
    expect(outstandingAmount('1200', '500')).toBe('700.00');
    expect(outstandingAmount('1200', '1500')).toBe('0.00');
  });
});

describe('isOverdue', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  const base = {
    type: 'SALES_INVOICE',
    lifecycle: 'VALIDATED',
    fulfilment: 'NOT_APPLICABLE',
    settlement: 'UNPAID',
  } as const;

  it('is true past the due date while money is owed', () => {
    expect(isOverdue({ ...base, dueDate: '2026-09-30' }, now)).toBe(true);
  });

  it('is false before the due date', () => {
    expect(isOverdue({ ...base, dueDate: '2026-10-31' }, now)).toBe(false);
  });

  it('is false once paid, however late', () => {
    expect(isOverdue({ ...base, settlement: 'PAID', dueDate: '2020-01-01' }, now)).toBe(false);
  });

  it('is false for a draft or a cancelled document', () => {
    expect(isOverdue({ ...base, lifecycle: 'DRAFT', dueDate: '2020-01-01' }, now)).toBe(false);
    expect(isOverdue({ ...base, lifecycle: 'CANCELLED', dueDate: '2020-01-01' }, now)).toBe(false);
  });

  it('is false with no due date at all', () => {
    expect(isOverdue({ ...base, dueDate: null }, now)).toBe(false);
  });

  it('survives an unparseable date instead of throwing', () => {
    expect(isOverdue({ ...base, dueDate: 'not-a-date' }, now)).toBe(false);
  });
});

describe('documentBadges', () => {
  const now = new Date('2026-10-06T12:00:00Z');

  it('shows cancelled alone, suppressing everything else', () => {
    const badges = documentBadges(
      {
        type: 'SALES_INVOICE',
        lifecycle: 'CANCELLED',
        fulfilment: 'COMPLETE',
        settlement: 'PAID',
        dueDate: '2020-01-01',
      },
      now,
    );
    expect(badges.map((b) => b.key)).toEqual(['CANCELLED']);
  });

  it('shows only the lifecycle for a draft', () => {
    const badges = documentBadges(
      { type: 'SALES_INVOICE', lifecycle: 'DRAFT', fulfilment: 'PENDING', settlement: 'UNPAID' },
      now,
    );
    expect(badges.map((b) => b.key)).toEqual(['DRAFT']);
  });

  it('combines sent, partially delivered and overdue — which one enum could not', () => {
    const badges = documentBadges(
      {
        type: 'SALES_ORDER',
        lifecycle: 'SENT',
        fulfilment: 'PARTIAL',
        settlement: 'NOT_APPLICABLE',
      },
      now,
    );
    expect(badges.map((b) => b.key)).toEqual(['SENT', 'PARTIALLY_FULFILLED']);
  });

  it('labels an order as delivered and a delivery note as invoiced', () => {
    const order = documentBadges(
      { type: 'SALES_ORDER', lifecycle: 'VALIDATED', fulfilment: 'COMPLETE', settlement: 'NOT_APPLICABLE' },
      now,
    );
    const note = documentBadges(
      { type: 'DELIVERY_NOTE', lifecycle: 'VALIDATED', fulfilment: 'COMPLETE', settlement: 'NOT_APPLICABLE' },
      now,
    );
    expect(order.at(-1)?.labelKey).toBe('fulfilment.delivered.complete');
    expect(note.at(-1)?.labelKey).toBe('fulfilment.invoiced.complete');
  });

  it('shows overdue and partially paid together', () => {
    const badges = documentBadges(
      {
        type: 'SALES_INVOICE',
        lifecycle: 'SENT',
        fulfilment: 'NOT_APPLICABLE',
        settlement: 'PARTIAL',
        dueDate: '2026-09-01',
      },
      now,
    );
    expect(badges.map((b) => b.key)).toEqual(['SENT', 'OVERDUE', 'PARTIALLY_PAID']);
  });

  it('marks a paid invoice as paid, not overdue', () => {
    const badges = documentBadges(
      {
        type: 'SALES_INVOICE',
        lifecycle: 'SENT',
        fulfilment: 'NOT_APPLICABLE',
        settlement: 'PAID',
        dueDate: '2026-09-01',
      },
      now,
    );
    expect(badges.map((b) => b.key)).toEqual(['SENT', 'PAID']);
  });

  it('gives every badge a tone for the UI', () => {
    const badges = documentBadges(
      {
        type: 'SALES_INVOICE',
        lifecycle: 'VALIDATED',
        fulfilment: 'NOT_APPLICABLE',
        settlement: 'UNPAID',
        dueDate: '2026-12-01',
      },
      now,
    );
    expect(badges.every((b) => b.tone && b.labelKey)).toBe(true);
  });
});
