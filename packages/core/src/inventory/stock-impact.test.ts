import { describe, expect, it } from 'vitest';
import {
  checkAvailability,
  invertPlan,
  resolveStockImpact,
  type StockImpactInput,
} from './stock-impact';
import type { DocumentType } from '../documents/types';

const WH = 'wh-main';
const V = 'variant-1';

function doc(
  documentType: DocumentType,
  lines: StockImpactInput['lines'],
  extra: Partial<StockImpactInput> = {},
) {
  return resolveStockImpact({
    documentType,
    documentId: `doc-${documentType}`,
    defaultWarehouseId: WH,
    lines,
    ...extra,
  });
}

const plainLine = (quantity: string, sources: StockImpactInput['lines'][number]['sources'] = []) => ({
  lineId: 'line-1',
  variantId: V,
  quantity,
  sources,
});

describe('resolveStockImpact — documents that do not move stock', () => {
  it('a quote moves nothing and reserves nothing', () => {
    const plan = doc('DEVIS', [plainLine('10')]);
    expect(plan.movements).toEqual([]);
    expect(plan.reservations).toEqual([]);
  });

  it('a sales order reserves without changing on-hand', () => {
    const plan = doc('SALES_ORDER', [plainLine('10')]);
    expect(plan.movements).toEqual([]);
    expect(plan.reservations).toHaveLength(1);
    expect(plan.reservations[0]).toMatchObject({
      action: 'HOLD',
      direction: 'OUT',
      quantity: '10.000000',
    });
    expect(plan.netByVariant).toEqual([]);
  });

  it('a purchase order places an incoming reservation', () => {
    const plan = doc('PURCHASE_ORDER', [plainLine('25')]);
    expect(plan.movements).toEqual([]);
    expect(plan.reservations[0]).toMatchObject({ action: 'HOLD', direction: 'IN' });
  });
});

describe('resolveStockImpact — the residual rule (no double deduction)', () => {
  it('a delivery note from an order deducts the full quantity', () => {
    // The order reserved but never moved stock, so nothing nets against it.
    const plan = doc('DELIVERY_NOTE', [
      plainLine('10', [
        {
          sourceDocumentType: 'SALES_ORDER',
          sourceDocumentId: 'so-1',
          sourceLineId: 'so-line-1',
          quantity: '10',
        },
      ]),
    ]);

    expect(plan.movements).toHaveLength(1);
    expect(plan.movements[0]).toMatchObject({ direction: 'OUT', signedQuantity: '-10.000000' });
    // ...and it consumes the order's hold in the same transaction.
    expect(plan.reservations).toEqual([
      expect.objectContaining({ action: 'RELEASE', direction: 'OUT', quantity: '10.000000' }),
    ]);
  });

  it('an invoice after a full delivery note moves NO stock', () => {
    const plan = doc('SALES_INVOICE', [
      plainLine('10', [
        {
          sourceDocumentType: 'DELIVERY_NOTE',
          sourceDocumentId: 'bl-1',
          sourceLineId: 'bl-line-1',
          quantity: '10',
        },
      ]),
    ]);

    expect(plan.movements).toEqual([]);
    expect(plan.netByVariant).toEqual([]);
    // The delivery note already released the hold; the invoice must not touch it.
    expect(plan.reservations).toEqual([]);
  });

  it('an invoice after a PARTIAL delivery note moves only the remainder', () => {
    const plan = doc('SALES_INVOICE', [
      plainLine('10', [
        {
          sourceDocumentType: 'DELIVERY_NOTE',
          sourceDocumentId: 'bl-1',
          sourceLineId: 'bl-line-1',
          quantity: '4',
        },
      ]),
    ]);

    expect(plan.movements).toHaveLength(1);
    expect(plan.movements[0]).toMatchObject({ quantity: '6.000000', signedQuantity: '-6.000000' });
  });

  it('a direct invoice with no delivery note deducts everything', () => {
    const plan = doc('SALES_INVOICE', [plainLine('10')]);
    expect(plan.movements[0]).toMatchObject({ signedQuantity: '-10.000000' });
  });

  it('an invoice consolidating two delivery notes moves no stock', () => {
    const plan = doc('SALES_INVOICE', [
      plainLine('10', [
        {
          sourceDocumentType: 'DELIVERY_NOTE',
          sourceDocumentId: 'bl-1',
          sourceLineId: 'bl-line-1',
          quantity: '4',
        },
        {
          sourceDocumentType: 'DELIVERY_NOTE',
          sourceDocumentId: 'bl-2',
          sourceLineId: 'bl-line-2',
          quantity: '6',
        },
      ]),
    ]);
    expect(plan.movements).toEqual([]);
  });

  it('an invoice drawn from an order (delivery note skipped) deducts in full', () => {
    const plan = doc('SALES_INVOICE', [
      plainLine('10', [
        {
          sourceDocumentType: 'SALES_ORDER',
          sourceDocumentId: 'so-1',
          sourceLineId: 'so-line-1',
          quantity: '10',
        },
      ]),
    ]);

    expect(plan.movements[0]).toMatchObject({ signedQuantity: '-10.000000' });
    // The order's hold has not been released by anything yet, so this does it.
    expect(plan.reservations).toEqual([
      expect.objectContaining({ action: 'RELEASE', quantity: '10.000000' }),
    ]);
  });

  it('never produces a negative movement when upstream drew more than the line', () => {
    const plan = doc('SALES_INVOICE', [
      plainLine('4', [
        {
          sourceDocumentType: 'DELIVERY_NOTE',
          sourceDocumentId: 'bl-1',
          sourceLineId: 'bl-line-1',
          quantity: '10',
        },
      ]),
    ]);
    expect(plan.movements).toEqual([]);
  });
});

describe('resolveStockImpact — purchase side', () => {
  it('a goods receipt adds stock at cost and releases the PO expectation', () => {
    const plan = doc('GOODS_RECEIPT', [
      {
        lineId: 'line-1',
        variantId: V,
        quantity: '50',
        unitCost: '12.5',
        sources: [
          {
            sourceDocumentType: 'PURCHASE_ORDER',
            sourceDocumentId: 'po-1',
            sourceLineId: 'po-line-1',
            quantity: '50',
          },
        ],
      },
    ]);

    expect(plan.movements[0]).toMatchObject({
      direction: 'IN',
      signedQuantity: '50.000000',
      unitCost: '12.500000',
    });
    expect(plan.reservations[0]).toMatchObject({ action: 'RELEASE', direction: 'IN' });
  });

  it('a purchase invoice after a goods receipt adds nothing', () => {
    const plan = doc('PURCHASE_INVOICE', [
      plainLine('50', [
        {
          sourceDocumentType: 'GOODS_RECEIPT',
          sourceDocumentId: 'br-1',
          sourceLineId: 'br-line-1',
          quantity: '50',
        },
      ]),
    ]);
    expect(plan.movements).toEqual([]);
  });

  it('a purchase invoice with a partial receipt adds only the remainder', () => {
    const plan = doc('PURCHASE_INVOICE', [
      plainLine('50', [
        {
          sourceDocumentType: 'GOODS_RECEIPT',
          sourceDocumentId: 'br-1',
          sourceLineId: 'br-line-1',
          quantity: '30',
        },
      ]),
    ]);
    expect(plan.movements[0]).toMatchObject({ signedQuantity: '20.000000' });
  });
});

describe('resolveStockImpact — credit notes', () => {
  const sourcedFromInvoice = plainLine('3', [
    {
      sourceDocumentType: 'SALES_INVOICE',
      sourceDocumentId: 'fa-1',
      sourceLineId: 'fa-line-1',
      quantity: '3',
    },
  ]);

  it('restocks when the goods came back', () => {
    const plan = doc('CREDIT_NOTE', [sourcedFromInvoice], { returnToStock: true });
    expect(plan.movements).toHaveLength(1);
    expect(plan.movements[0]).toMatchObject({ direction: 'IN', signedQuantity: '3.000000' });
  });

  it('moves nothing when the customer kept the goods', () => {
    const plan = doc('CREDIT_NOTE', [sourcedFromInvoice], { returnToStock: false });
    expect(plan.movements).toEqual([]);
  });

  it('defaults to not restocking, so a money-only credit is the safe path', () => {
    const plan = doc('CREDIT_NOTE', [sourcedFromInvoice]);
    expect(plan.movements).toEqual([]);
  });

  it('does not net against the invoice it credits, because the direction differs', () => {
    // The invoice moved 3 OUT; the credit note must still move 3 IN.
    const plan = doc('CREDIT_NOTE', [sourcedFromInvoice], { returnToStock: true });
    expect(plan.movements[0]?.quantity).toBe('3.000000');
  });
});

describe('resolveStockImpact — lines that carry no stock', () => {
  it('skips narrative and service lines', () => {
    const plan = doc('SALES_INVOICE', [
      { lineId: 'a', variantId: null, quantity: '1' },
      { lineId: 'b', variantId: V, quantity: '5', isService: true },
      { lineId: 'c', variantId: V, quantity: '2' },
    ]);
    expect(plan.movements).toHaveLength(1);
    expect(plan.movements[0]?.lineId).toBe('c');
  });

  it('skips zero and negative quantities', () => {
    const plan = doc('SALES_INVOICE', [
      { lineId: 'a', variantId: V, quantity: '0' },
      { lineId: 'b', variantId: V, quantity: '-3' },
    ]);
    expect(plan.movements).toEqual([]);
  });

  it('refuses a stock line with no warehouse anywhere', () => {
    expect(() =>
      resolveStockImpact({
        documentType: 'DELIVERY_NOTE',
        documentId: 'd1',
        lines: [{ lineId: 'a', variantId: V, quantity: '1' }],
      }),
    ).toThrow(/no warehouse/i);
  });

  it('prefers the line warehouse over the document default', () => {
    const plan = doc('DELIVERY_NOTE', [
      { lineId: 'a', variantId: V, quantity: '1', warehouseId: 'wh-other' },
    ]);
    expect(plan.movements[0]?.warehouseId).toBe('wh-other');
  });
});

describe('resolveStockImpact — net aggregation', () => {
  it('nets several lines of the same variant in the same warehouse', () => {
    const plan = doc('DELIVERY_NOTE', [
      { lineId: 'a', variantId: V, quantity: '3' },
      { lineId: 'b', variantId: V, quantity: '2' },
      { lineId: 'c', variantId: 'variant-2', quantity: '7' },
    ]);
    expect(plan.netByVariant).toEqual([
      { variantId: V, warehouseId: WH, signedQuantity: '-5.000000' },
      { variantId: 'variant-2', warehouseId: WH, signedQuantity: '-7.000000' },
    ]);
  });
});

describe('invertPlan', () => {
  it('produces compensating movements that cancel the original', () => {
    const plan = doc('DELIVERY_NOTE', [plainLine('10')]);
    const inverse = invertPlan(plan);

    expect(inverse.movements[0]).toMatchObject({ direction: 'IN', signedQuantity: '10.000000' });
    expect(Number(plan.netByVariant[0]!.signedQuantity) + Number(inverse.netByVariant[0]!.signedQuantity)).toBe(0);
  });

  it('turns a hold back into a release', () => {
    const plan = doc('SALES_ORDER', [plainLine('4')]);
    expect(invertPlan(plan).reservations[0]).toMatchObject({ action: 'RELEASE' });
  });
});

describe('checkAvailability', () => {
  const plan = doc('DELIVERY_NOTE', [plainLine('10')]);

  it('passes when there is enough on hand', () => {
    const verdict = checkAvailability(plan, [{ variantId: V, warehouseId: WH, onHand: '10', reserved: '0' }]);
    expect(verdict.ok).toBe(true);
    expect(verdict.shortfalls).toEqual([]);
  });

  it('blocks and names the shortfall under BLOCK', () => {
    const verdict = checkAvailability(
      plan,
      [{ variantId: V, warehouseId: WH, onHand: '4', reserved: '0' }],
      'BLOCK',
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.shortfalls[0]).toMatchObject({ requested: '10.000000', available: '4.000000', shortBy: '6.000000' });
  });

  it('asks for confirmation under WARN', () => {
    const verdict = checkAvailability(
      plan,
      [{ variantId: V, warehouseId: WH, onHand: '4', reserved: '0' }],
      'WARN',
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.requiresConfirmation).toBe(true);
    expect(verdict.shortfalls).toHaveLength(1);
  });

  it('skips the check entirely under ALLOW', () => {
    const verdict = checkAvailability(plan, [], 'ALLOW');
    expect(verdict.ok).toBe(true);
    expect(verdict.shortfalls).toEqual([]);
  });

  it('does not penalise a delivery for the hold placed by its own order', () => {
    // 10 on hand, all 10 reserved by the order being delivered: this must pass.
    const fromOrder = doc('DELIVERY_NOTE', [
      plainLine('10', [
        { sourceDocumentType: 'SALES_ORDER', sourceDocumentId: 'so-1', sourceLineId: 'sl-1', quantity: '10' },
      ]),
    ]);
    const verdict = checkAvailability(fromOrder, [
      { variantId: V, warehouseId: WH, onHand: '10', reserved: '10' },
    ]);
    expect(verdict.ok).toBe(true);
  });

  it('treats a missing level row as zero stock', () => {
    const verdict = checkAvailability(plan, [], 'BLOCK');
    expect(verdict.ok).toBe(false);
    expect(verdict.shortfalls[0]?.available).toBe('0.000000');
  });

  it('ignores inbound movements', () => {
    const receipt = doc('GOODS_RECEIPT', [plainLine('100')]);
    expect(checkAvailability(receipt, [], 'BLOCK').ok).toBe(true);
  });
});
