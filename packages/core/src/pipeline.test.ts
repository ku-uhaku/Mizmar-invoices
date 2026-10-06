import { beforeEach, describe, expect, it } from 'vitest';
import { planConversion, type ConversionSource, type ConvertibleLine } from './documents/conversion';
import { computeFulfilment } from './documents/status';
import { resolveStockImpact, type LineSourceDraw } from './inventory/stock-impact';
import { computeTotals } from './totals';
import type { DocumentType } from './documents/types';
import { dec } from './money';

/**
 * A minimal in-memory stand-in for the API's documents + stock ledger, built
 * only from `packages/core`.
 *
 * The point of these tests is the end-to-end arithmetic of the pipeline: that
 * walking quote -> order -> delivery notes -> invoice moves stock exactly once
 * in total, whatever route the user takes. The API's own e2e suite re-asserts
 * the same invariants against real Postgres rows.
 */

interface SimLine extends ConvertibleLine {
  sources: LineSourceDraw[];
}

interface SimDoc extends ConversionSource {
  lines: SimLine[];
}

const WH = 'wh-main';
const VARIANT = 'v-widget-red-l';

class Sim {
  private seq = 0;
  readonly docs = new Map<string, SimDoc>();
  /** Signed on-hand change per variant, i.e. the whole ledger collapsed. */
  onHand = dec(0);
  reserved = dec(0);
  movementCount = 0;

  open(type: DocumentType, lines: Array<Partial<ConvertibleLine>>): SimDoc {
    this.seq += 1;
    const id = `${type}-${this.seq}`;
    const doc: SimDoc = {
      documentId: id,
      documentNumber: `${type}/${this.seq}`,
      documentType: type,
      lifecycle: 'DRAFT',
      companyId: 'co-1',
      contactId: 'client-1',
      currency: 'MAD',
      lines: lines.map((l, i) => ({
        lineId: `${id}-l${i + 1}`,
        variantId: l.variantId ?? VARIANT,
        description: l.description ?? 'Widget / Red / L',
        quantity: l.quantity ?? '1',
        drawnQuantity: '0',
        unitPrice: l.unitPrice ?? '250',
        vatRate: l.vatRate ?? '20',
        discount: l.discount ?? null,
        unitCost: l.unitCost ?? null,
        warehouseId: l.warehouseId ?? WH,
        sources: [],
      })),
    };
    this.docs.set(id, doc);
    return doc;
  }

  /** Validate: write the stock plan, exactly as the API does in one transaction. */
  validate(doc: SimDoc, options: { returnToStock?: boolean } = {}): void {
    const plan = resolveStockImpact({
      documentType: doc.documentType,
      documentId: doc.documentId,
      defaultWarehouseId: WH,
      returnToStock: options.returnToStock,
      lines: doc.lines.map((l) => ({
        lineId: l.lineId,
        variantId: l.variantId,
        warehouseId: l.warehouseId,
        quantity: l.quantity,
        unitCost: l.unitCost,
        sources: l.sources,
      })),
    });

    for (const movement of plan.movements) {
      this.onHand = this.onHand.plus(dec(movement.signedQuantity));
      this.movementCount += 1;
    }
    for (const reservation of plan.reservations) {
      const q = dec(reservation.quantity);
      this.reserved =
        reservation.action === 'HOLD' ? this.reserved.plus(q) : this.reserved.minus(q);
    }

    doc.lifecycle = 'VALIDATED';
  }

  /** Convert, and record downstream draws on the sources so remainders shrink. */
  convert(
    sourceIds: string[],
    target: DocumentType,
    selections?: Array<{ sourceDocumentId: string; sourceLineId: string; quantity: string }>,
  ): SimDoc {
    const sources = sourceIds.map((id) => {
      const doc = this.docs.get(id);
      if (!doc) throw new Error(`unknown source ${id}`);
      return doc;
    });

    const plan = planConversion(sources, target, selections);
    this.seq += 1;
    const id = `${target}-${this.seq}`;

    const doc: SimDoc = {
      documentId: id,
      documentNumber: `${target}/${this.seq}`,
      documentType: target,
      lifecycle: 'DRAFT',
      companyId: plan.companyId,
      contactId: plan.contactId,
      currency: plan.currency,
      lines: plan.lines.map((l, i) => ({
        lineId: `${id}-l${i + 1}`,
        variantId: l.variantId,
        description: l.description,
        quantity: l.quantity,
        drawnQuantity: '0',
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
        discount: l.discount,
        unitCost: l.unitCost,
        warehouseId: l.warehouseId,
        sources: l.sources.map((s) => ({
          sourceDocumentType: s.sourceDocumentType,
          sourceDocumentId: s.sourceDocumentId,
          sourceLineId: s.sourceLineId,
          quantity: s.quantity,
        })),
      })),
    };

    for (const line of doc.lines) {
      for (const draw of line.sources) {
        const sourceDoc = this.docs.get(draw.sourceDocumentId);
        const sourceLine = sourceDoc?.lines.find((l) => l.lineId === draw.sourceLineId);
        if (sourceLine) {
          sourceLine.drawnQuantity = dec(sourceLine.drawnQuantity).plus(dec(draw.quantity)).toFixed(6);
        }
      }
    }

    this.docs.set(id, doc);
    return doc;
  }

  fulfilmentOf(id: string) {
    const doc = this.docs.get(id)!;
    return computeFulfilment(doc.documentType, doc.lines);
  }
}

describe('sales pipeline — stock moves exactly once', () => {
  let sim: Sim;

  beforeEach(() => {
    sim = new Sim();
    // Opening stock, as a goods receipt would have put it there.
    sim.onHand = dec(100);
  });

  it('quote -> order -> two delivery notes -> one invoice', () => {
    const quote = sim.open('DEVIS', [{ quantity: '10' }]);
    sim.validate(quote);
    expect(sim.onHand.toFixed()).toBe('100'); // a quote touches nothing

    const order = sim.convert([quote.documentId], 'SALES_ORDER');
    sim.validate(order);
    expect(sim.onHand.toFixed()).toBe('100'); // reserved, not shipped
    expect(sim.reserved.toFixed()).toBe('10');
    expect(sim.fulfilmentOf(quote.documentId)).toBe('COMPLETE');

    // Ship 4 of 10.
    const bl1 = sim.convert([order.documentId], 'DELIVERY_NOTE', [
      { sourceDocumentId: order.documentId, sourceLineId: order.lines[0]!.lineId, quantity: '4' },
    ]);
    sim.validate(bl1);
    expect(sim.onHand.toFixed()).toBe('96');
    expect(sim.reserved.toFixed()).toBe('6');
    expect(sim.fulfilmentOf(order.documentId)).toBe('PARTIAL');

    // Ship the rest; the remainder defaults correctly with no arithmetic by the user.
    const bl2 = sim.convert([order.documentId], 'DELIVERY_NOTE');
    expect(bl2.lines[0]?.quantity).toBe('6.000000');
    sim.validate(bl2);
    expect(sim.onHand.toFixed()).toBe('90');
    expect(sim.reserved.toFixed()).toBe('0');
    expect(sim.fulfilmentOf(order.documentId)).toBe('COMPLETE');

    // Invoice both delivery notes as one invoice.
    const invoice = sim.convert([bl1.documentId, bl2.documentId], 'SALES_INVOICE');
    expect(invoice.lines).toHaveLength(2);
    sim.validate(invoice);

    // The whole point: 10 units left stock, once.
    expect(sim.onHand.toFixed()).toBe('90');
    expect(sim.movementCount).toBe(2); // the two delivery notes, and nothing else
    expect(sim.fulfilmentOf(bl1.documentId)).toBe('COMPLETE');
    expect(sim.fulfilmentOf(bl2.documentId)).toBe('COMPLETE');

    const totals = computeTotals({
      lines: invoice.lines.map((l) => ({
        id: l.lineId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
      })),
    });
    expect(totals.totalHT).toBe('2500.00');
    expect(totals.totalTTC).toBe('3000.00');
  });

  it('quote -> invoice directly, skipping order and delivery note', () => {
    const quote = sim.open('DEVIS', [{ quantity: '10' }]);
    sim.validate(quote);

    const invoice = sim.convert([quote.documentId], 'SALES_INVOICE');
    sim.validate(invoice);

    expect(sim.onHand.toFixed()).toBe('90');
    expect(sim.movementCount).toBe(1);
  });

  it('order -> invoice (no delivery note) deducts once and clears the hold', () => {
    const order = sim.open('SALES_ORDER', [{ quantity: '10' }]);
    sim.validate(order);
    expect(sim.reserved.toFixed()).toBe('10');

    const invoice = sim.convert([order.documentId], 'SALES_INVOICE');
    sim.validate(invoice);

    expect(sim.onHand.toFixed()).toBe('90');
    expect(sim.reserved.toFixed()).toBe('0');
    expect(sim.movementCount).toBe(1);
  });

  it('delivery note then a partial invoice still deducts only what shipped', () => {
    const bl = sim.open('DELIVERY_NOTE', [{ quantity: '10' }]);
    sim.validate(bl);
    expect(sim.onHand.toFixed()).toBe('90');

    const invoice = sim.convert([bl.documentId], 'SALES_INVOICE', [
      { sourceDocumentId: bl.documentId, sourceLineId: bl.lines[0]!.lineId, quantity: '4' },
    ]);
    sim.validate(invoice);

    // Invoicing less than was delivered is a billing decision, not a stock event.
    expect(sim.onHand.toFixed()).toBe('90');
    expect(sim.movementCount).toBe(1);
    expect(sim.fulfilmentOf(bl.documentId)).toBe('PARTIAL');
  });

  it('a credit note with a return puts the goods back, once', () => {
    const invoice = sim.open('SALES_INVOICE', [{ quantity: '10' }]);
    sim.validate(invoice);
    expect(sim.onHand.toFixed()).toBe('90');

    const credit = sim.convert([invoice.documentId], 'CREDIT_NOTE', [
      { sourceDocumentId: invoice.documentId, sourceLineId: invoice.lines[0]!.lineId, quantity: '3' },
    ]);
    sim.validate(credit, { returnToStock: true });

    expect(sim.onHand.toFixed()).toBe('93');
  });

  it('a credit note without a return leaves stock alone', () => {
    const invoice = sim.open('SALES_INVOICE', [{ quantity: '10' }]);
    sim.validate(invoice);

    const credit = sim.convert([invoice.documentId], 'CREDIT_NOTE');
    sim.validate(credit, { returnToStock: false });

    expect(sim.onHand.toFixed()).toBe('90');
  });

  it('refuses to ship more than the order, across repeated conversions', () => {
    const order = sim.open('SALES_ORDER', [{ quantity: '10' }]);
    sim.validate(order);

    sim.convert([order.documentId], 'DELIVERY_NOTE', [
      { sourceDocumentId: order.documentId, sourceLineId: order.lines[0]!.lineId, quantity: '7' },
    ]);

    expect(() =>
      sim.convert([order.documentId], 'DELIVERY_NOTE', [
        { sourceDocumentId: order.documentId, sourceLineId: order.lines[0]!.lineId, quantity: '4' },
      ]),
    ).toThrow(/only 3 remain/);
  });

  it('runs the purchase chain with the same machinery', () => {
    sim.onHand = dec(0);
    const po = sim.open('PURCHASE_ORDER', [{ quantity: '50', unitCost: '12.5' }]);
    sim.validate(po);
    expect(sim.onHand.toFixed()).toBe('0');
    expect(sim.reserved.toFixed()).toBe('50'); // incoming expectation

    const receipt = sim.convert([po.documentId], 'GOODS_RECEIPT');
    sim.validate(receipt);
    expect(sim.onHand.toFixed()).toBe('50');
    expect(sim.reserved.toFixed()).toBe('0');

    const purchaseInvoice = sim.convert([receipt.documentId], 'PURCHASE_INVOICE');
    sim.validate(purchaseInvoice);
    expect(sim.onHand.toFixed()).toBe('50'); // received once, not twice
    expect(sim.movementCount).toBe(1);
  });

  it('receives a short delivery and then the backorder', () => {
    sim.onHand = dec(0);
    const po = sim.open('PURCHASE_ORDER', [{ quantity: '50', unitCost: '10' }]);
    sim.validate(po);

    const partial = sim.convert([po.documentId], 'GOODS_RECEIPT', [
      { sourceDocumentId: po.documentId, sourceLineId: po.lines[0]!.lineId, quantity: '30' },
    ]);
    sim.validate(partial);
    expect(sim.onHand.toFixed()).toBe('30');
    expect(sim.reserved.toFixed()).toBe('20'); // 20 still expected
    expect(sim.fulfilmentOf(po.documentId)).toBe('PARTIAL');

    const rest = sim.convert([po.documentId], 'GOODS_RECEIPT');
    sim.validate(rest);
    expect(sim.onHand.toFixed()).toBe('50');
    expect(sim.reserved.toFixed()).toBe('0');
    expect(sim.fulfilmentOf(po.documentId)).toBe('COMPLETE');
  });
});
