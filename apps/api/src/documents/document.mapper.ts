import {
  conversionTargets,
  canCancel as coreCanCancel,
  dec,
  documentBadges,
  draftLabel,
  isEditable,
  isOverdue,
  outstandingAmount,
  toBaseAmount,
} from '@mizmar/core';
import type { Prisma } from '@prisma/client';
import type { documentSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { moneyOut, nullableMoneyOut, nullableQtyOut, qtyOut, rateOut } from '../common/util/decimal';
import type { DocumentLineWithRelations, DocumentWithRelations } from './document-include';

type DocumentDetail = z.infer<typeof documentSchemas.documentDetail>;
type DocumentLineDto = z.infer<typeof documentSchemas.documentLine>;
type VatBucket = { rate: string; base: string; amount: string };

/** Live availability per variant+warehouse, injected so the editor can warn. */
export type AvailabilityIndex = Map<string, { available: string; isLowStock: boolean }>;

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);
const isoDateOrNull = (value: Date | null): string | null => (value ? isoDate(value) : null);
const isoOrNull = (value: Date | null): string | null => value?.toISOString() ?? null;

export function mapLine(
  line: DocumentLineWithRelations,
  availability?: AvailabilityIndex,
): DocumentLineDto {
  const key =
    line.variantId && line.warehouseId ? `${line.variantId}::${line.warehouseId}` : null;
  const stock = key ? availability?.get(key) : undefined;

  const remaining = dec(line.quantity).minus(dec(line.drawnQuantity));

  return {
    id: line.id,
    variantId: line.variantId,
    warehouseId: line.warehouseId,
    sku: line.sku ?? line.variant?.sku ?? null,
    description: line.description,
    variantLabel: line.variantLabel ?? line.variant?.variantLabel ?? null,
    unitCode: line.unitCode,
    quantity: qtyOut(line.quantity),
    unitPrice: qtyOut(line.unitPrice),
    unitCost: nullableQtyOut(line.unitCost),
    vatRate: rateOut(line.vatRate),
    discountKind: line.discountKind,
    discountValue: nullableQtyOut(line.discountValue),
    lineGross: moneyOut(line.lineGross),
    lineDiscount: moneyOut(line.lineDiscount),
    lineNet: moneyOut(line.lineNet),
    globalDiscountShare: moneyOut(line.globalDiscountShare),
    taxableBase: moneyOut(line.taxableBase),
    vatAmount: moneyOut(line.vatAmount),
    lineTotal: moneyOut(line.lineTotal),
    drawnQuantity: qtyOut(line.drawnQuantity),
    remainingQuantity: qtyOut(remaining.isNegative() ? 0 : remaining),
    isNote: line.isNote,
    isService: line.isService,
    sortOrder: line.sortOrder,
    sources: line.sources.map((source) => ({
      sourceDocumentId: source.sourceDocumentId,
      sourceDocumentType: source.sourceDocumentType,
      sourceDocumentNumber: source.sourceLine.document.number,
      sourceLineId: source.sourceLineId,
      quantity: qtyOut(source.quantity),
    })),
    ...(stock ? { available: stock.available, isLowStock: stock.isLowStock } : {}),
  };
}

export function mapDocument(
  document: DocumentWithRelations,
  options: { availability?: AvailabilityIndex; now?: Date } = {},
): DocumentDetail {
  const now = options.now ?? new Date();

  const statusInput = {
    type: document.type,
    lifecycle: document.lifecycle,
    fulfilment: document.fulfilment,
    settlement: document.settlement,
    dueDate: document.dueDate,
  };

  const vatBreakdown = (document.vatBreakdown as VatBucket[] | null) ?? [];

  return {
    id: document.id,
    companyId: document.companyId,
    type: document.type,
    side: document.side,
    number: document.number,
    // A draft shows a stable short label; it has not consumed a real number yet.
    draftLabel: document.number ? null : draftLabel(document.id),
    lifecycle: document.lifecycle,
    fulfilment: document.fulfilment,
    settlement: document.settlement,
    badges: documentBadges(statusInput, now),
    isOverdue: isOverdue(statusInput, now),
    isEditable: isEditable(document.lifecycle),
    canCancel:
      document.lifecycle !== 'CANCELLED' &&
      coreCanCancel(
        document.lines.map((line) => ({
          lineId: line.id,
          variantId: line.variantId,
          description: line.description,
          quantity: qtyOut(line.quantity),
          drawnQuantity: qtyOut(line.drawnQuantity),
          unitPrice: qtyOut(line.unitPrice),
          vatRate: rateOut(line.vatRate),
        })),
      ),
    conversionTargets:
      document.lifecycle === 'VALIDATED' || document.lifecycle === 'SENT'
        ? [...conversionTargets(document.type)]
        : [],

    contactId: document.contactId,
    contactName: document.contact.displayName,
    contactIce: document.contact.ice,
    billingAddressId: document.billingAddressId,
    shippingAddressId: document.shippingAddressId,
    warehouseId: document.warehouseId,

    issueDate: isoDate(document.issueDate),
    dueDate: isoDateOrNull(document.dueDate),
    validUntil: isoDateOrNull(document.validUntil),
    deliveryDate: isoDateOrNull(document.deliveryDate),

    currency: document.currency,
    exchangeRate: dec(document.exchangeRate).toFixed(8),
    locale: document.locale,
    priceMode: document.priceMode,

    globalDiscountKind: document.globalDiscountKind,
    globalDiscountValue: nullableQtyOut(document.globalDiscountValue),
    shippingAmount: nullableMoneyOut(document.shippingAmount),
    shippingVatRate: document.shippingVatRate === null ? null : rateOut(document.shippingVatRate),

    totals: {
      subtotalGross: moneyOut(document.subtotalGross),
      totalLineDiscounts: moneyOut(document.totalLineDiscounts),
      subtotalNet: moneyOut(document.subtotalNet),
      globalDiscount: moneyOut(document.globalDiscount),
      shippingNet: moneyOut(document.shippingAmount ?? 0),
      totalExclVat: moneyOut(document.totalExclVat),
      vatBuckets: vatBreakdown,
      totalVat: moneyOut(document.totalVat),
      totalInclVat: moneyOut(document.totalInclVat),
    },
    baseTotals: baseTotalsOf(document),
    vatBreakdown,
    paidAmount: moneyOut(document.paidAmount),
    outstandingAmount:
      document.settlement === 'NOT_APPLICABLE'
        ? '0.00'
        : outstandingAmount(dec(document.totalInclVat).toFixed(), dec(document.paidAmount).toFixed()),
    returnToStock: document.returnToStock,

    reference: document.reference,
    projectName: document.projectName,
    notes: document.notes,
    terms: document.terms,
    internalMemo: document.internalMemo,
    templateConfigId: document.templateConfigId,

    lines: document.lines.map((line) => mapLine(line, options.availability)),
    links: {
      convertedFrom: document.linksTo.map((link) => ({
        id: link.sourceDocument.id,
        type: link.sourceDocument.type,
        number: link.sourceDocument.number,
        issueDate: isoDate(link.sourceDocument.issueDate),
      })),
      convertedTo: document.linksFrom.map((link) => ({
        id: link.targetDocument.id,
        type: link.targetDocument.type,
        number: link.targetDocument.number,
        issueDate: isoDate(link.targetDocument.issueDate),
        lifecycle: link.targetDocument.lifecycle,
      })),
    },

    createdById: document.createdById,
    createdByName: document.createdBy?.fullName ?? null,
    validatedAt: isoOrNull(document.validatedAt),
    sentAt: isoOrNull(document.sentAt),
    cancelledAt: isoOrNull(document.cancelledAt),
    cancelReason: document.cancelReason,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

/** Totals in the company currency: stored totals x the document's snapshotted rate. */
function baseTotalsOf(document: DocumentWithRelations) {
  const rounding = {
    mode: document.roundingMode,
    scale: document.roundingScale,
    granularity: document.roundingGranularity,
  };
  const base = (value: Prisma.Decimal) =>
    toBaseAmount(value.toString(), document.exchangeRate.toString(), rounding).toFixed(
      rounding.scale,
    );
  return {
    totalExclVat: base(document.totalExclVat),
    totalVat: base(document.totalVat),
    totalInclVat: base(document.totalInclVat),
  };
}
