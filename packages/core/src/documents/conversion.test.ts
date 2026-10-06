import { describe, expect, it } from 'vitest';
import {
  canCancel,
  ConversionError,
  hasRemainder,
  planConversion,
  remainingQuantity,
  type ConversionSource,
  type ConvertibleLine,
} from './conversion';

const line = (over: Partial<ConvertibleLine> = {}): ConvertibleLine => ({
  lineId: over.lineId ?? 'sl-1',
  variantId: over.variantId ?? 'v-1',
  description: over.description ?? 'Widget / Red / L',
  quantity: over.quantity ?? '10',
  drawnQuantity: over.drawnQuantity ?? '0',
  unitPrice: over.unitPrice ?? '250',
  vatRate: over.vatRate ?? '20',
  discount: over.discount ?? null,
  unitCost: over.unitCost ?? null,
  warehouseId: over.warehouseId ?? 'wh-main',
  isNote: over.isNote,
  isService: over.isService,
});

const source = (over: Partial<ConversionSource> = {}): ConversionSource => ({
  documentId: over.documentId ?? 'so-1',
  documentNumber: over.documentNumber ?? 'BC-2026-0001',
  documentType: over.documentType ?? 'SALES_ORDER',
  lifecycle: over.lifecycle ?? 'VALIDATED',
  companyId: over.companyId ?? 'co-1',
  contactId: over.contactId ?? 'client-1',
  currency: over.currency ?? 'MAD',
  lines: over.lines ?? [line()],
});

describe('remainingQuantity', () => {
  it('is quantity minus what downstream already drew', () => {
    expect(remainingQuantity(line({ quantity: '10', drawnQuantity: '4' }))).toBe('6.000000');
  });

  it('floors at zero rather than going negative', () => {
    expect(remainingQuantity(line({ quantity: '10', drawnQuantity: '12' }))).toBe('0.000000');
    expect(hasRemainder(line({ quantity: '10', drawnQuantity: '10' }))).toBe(false);
  });
});

describe('planConversion — guard rails', () => {
  it('refuses with no sources', () => {
    expect(() => planConversion([], 'DELIVERY_NOTE')).toThrow(ConversionError);
  });

  it('refuses to convert a draft', () => {
    try {
      planConversion([source({ lifecycle: 'DRAFT' })], 'DELIVERY_NOTE');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConversionError).code).toBe('SOURCE_NOT_VALIDATED');
    }
  });

  it('refuses an illegal target', () => {
    try {
      // A delivery note cannot become a purchase order.
      planConversion([source({ documentType: 'DELIVERY_NOTE' })], 'PURCHASE_ORDER');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConversionError).code).toBe('ILLEGAL_TARGET');
    }
  });

  it('refuses to mix companies, contacts or currencies', () => {
    const a = source({ documentId: 'a' });
    const codes = [
      [source({ documentId: 'b', companyId: 'co-2' }), 'MIXED_COMPANIES'],
      [source({ documentId: 'b', contactId: 'client-2' }), 'MIXED_CONTACTS'],
      [source({ documentId: 'b', currency: 'EUR' }), 'MIXED_CURRENCIES'],
    ] as const;

    for (const [other, expected] of codes) {
      try {
        planConversion([a, other], 'DELIVERY_NOTE');
        expect.unreachable(`should have thrown ${expected}`);
      } catch (error) {
        expect((error as ConversionError).code).toBe(expected);
      }
    }
  });

  it('refuses when everything is already converted', () => {
    try {
      planConversion([source({ lines: [line({ quantity: '10', drawnQuantity: '10' })] })], 'DELIVERY_NOTE');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConversionError).code).toBe('NOTHING_TO_CONVERT');
    }
  });

  it('refuses a quantity above the remainder — no over-delivery', () => {
    try {
      planConversion([source({ lines: [line({ quantity: '10', drawnQuantity: '6' })] })], 'DELIVERY_NOTE', [
        { sourceDocumentId: 'so-1', sourceLineId: 'sl-1', quantity: '5' },
      ]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConversionError).code).toBe('QUANTITY_EXCEEDS_REMAINDER');
      expect((error as ConversionError).details).toMatchObject({ remaining: '4' });
    }
  });

  it('refuses selections that individually fit but together overflow', () => {
    try {
      planConversion([source()], 'DELIVERY_NOTE', [
        { sourceDocumentId: 'so-1', sourceLineId: 'sl-1', quantity: '6' },
        { sourceDocumentId: 'so-1', sourceLineId: 'sl-1', quantity: '6' },
      ]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConversionError).code).toBe('QUANTITY_EXCEEDS_REMAINDER');
    }
  });

  it('refuses a line that belongs to no source', () => {
    try {
      planConversion([source()], 'DELIVERY_NOTE', [
        { sourceDocumentId: 'so-1', sourceLineId: 'ghost', quantity: '1' },
      ]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConversionError).code).toBe('UNKNOWN_LINE');
    }
  });
});

describe('planConversion — behaviour', () => {
  it('defaults every line to its full remainder', () => {
    const plan = planConversion(
      [source({ lines: [line({ quantity: '10', drawnQuantity: '4' })] })],
      'DELIVERY_NOTE',
    );
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]?.quantity).toBe('6.000000');
    expect(plan.targetType).toBe('DELIVERY_NOTE');
  });

  it('carries price, VAT, discount and warehouse through untouched', () => {
    const plan = planConversion(
      [
        source({
          lines: [
            line({ unitPrice: '199.99', vatRate: '14', discount: { kind: 'PERCENT', value: '5' }, warehouseId: 'wh-2' }),
          ],
        }),
      ],
      'DELIVERY_NOTE',
    );
    expect(plan.lines[0]).toMatchObject({
      unitPrice: '199.990000',
      vatRate: '14.00',
      discount: { kind: 'PERCENT', value: '5' },
      warehouseId: 'wh-2',
    });
  });

  it('records provenance so the residual rule can later net against it', () => {
    const plan = planConversion([source()], 'DELIVERY_NOTE');
    expect(plan.lines[0]?.sources).toEqual([
      {
        sourceDocumentId: 'so-1',
        sourceDocumentType: 'SALES_ORDER',
        sourceDocumentNumber: 'BC-2026-0001',
        sourceLineId: 'sl-1',
        quantity: '10.000000',
      },
    ]);
  });

  it('honours a partial selection', () => {
    const plan = planConversion([source()], 'DELIVERY_NOTE', [
      { sourceDocumentId: 'so-1', sourceLineId: 'sl-1', quantity: '4' },
    ]);
    expect(plan.lines[0]?.quantity).toBe('4.000000');
    expect(plan.lines[0]?.sources[0]?.quantity).toBe('4.000000');
  });

  it('skips lines whose remainder is zero', () => {
    const plan = planConversion(
      [
        source({
          lines: [
            line({ lineId: 'a', quantity: '5', drawnQuantity: '5' }),
            line({ lineId: 'b', quantity: '5', drawnQuantity: '2' }),
          ],
        }),
      ],
      'DELIVERY_NOTE',
    );
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]?.sources[0]?.sourceLineId).toBe('b');
  });

  it('excludes narrative lines from the default selection', () => {
    const plan = planConversion(
      [source({ lines: [line({ lineId: 'note', isNote: true }), line({ lineId: 'real' })] })],
      'DELIVERY_NOTE',
    );
    expect(plan.lines).toHaveLength(1);
  });

  it('consolidates several delivery notes into one invoice', () => {
    const bl1 = source({
      documentId: 'bl-1',
      documentNumber: 'BL-2026-0001',
      documentType: 'DELIVERY_NOTE',
      lines: [line({ lineId: 'bl1-l1', quantity: '4' })],
    });
    const bl2 = source({
      documentId: 'bl-2',
      documentNumber: 'BL-2026-0002',
      documentType: 'DELIVERY_NOTE',
      lines: [line({ lineId: 'bl2-l1', quantity: '6' })],
    });

    const plan = planConversion([bl1, bl2], 'SALES_INVOICE');

    expect(plan.sourceDocumentIds).toEqual(['bl-1', 'bl-2']);
    expect(plan.lines).toHaveLength(2);
    // Each line keeps its own BL reference, which is what the optional
    // "BL N° / date" column on the invoice prints.
    expect(plan.lines.map((l) => l.sources[0]?.sourceDocumentNumber)).toEqual([
      'BL-2026-0001',
      'BL-2026-0002',
    ]);
    expect(plan.lines.map((l) => l.sortOrder)).toEqual([1, 2]);
  });

  it('allows the shortcut paths the spec asks for', () => {
    expect(() => planConversion([source({ documentType: 'DEVIS' })], 'SALES_INVOICE')).not.toThrow();
    expect(() => planConversion([source({ documentType: 'DEVIS' })], 'DELIVERY_NOTE')).not.toThrow();
    expect(() => planConversion([source({ documentType: 'SALES_ORDER' })], 'SALES_INVOICE')).not.toThrow();
  });

  it('supports the purchase chain with the same engine', () => {
    const po = source({ documentId: 'po-1', documentType: 'PURCHASE_ORDER', contactId: 'supplier-1' });
    expect(planConversion([po], 'GOODS_RECEIPT').lines).toHaveLength(1);
    expect(planConversion([po], 'PURCHASE_INVOICE').lines).toHaveLength(1);
  });
});

describe('canCancel', () => {
  it('allows cancelling while nothing downstream references it', () => {
    expect(canCancel([line({ drawnQuantity: '0' })])).toBe(true);
  });

  it('refuses once a downstream document has drawn from it', () => {
    expect(canCancel([line({ drawnQuantity: '0' }), line({ lineId: 'b', drawnQuantity: '1' })])).toBe(false);
  });
});
