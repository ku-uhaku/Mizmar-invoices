import { dec, type Numeric } from '../money';
import type { Discount } from '../totals';
import { isLive } from './status';
import { meta, type DocumentType, type Lifecycle } from './types';

export interface ConvertibleLine {
  lineId: string;
  variantId: string | null;
  description: string;
  quantity: Numeric;
  /** How much of this line downstream documents have already drawn. */
  drawnQuantity: Numeric;
  unitPrice: Numeric;
  vatRate: Numeric;
  discount?: Discount | null;
  unitCost?: Numeric | null;
  warehouseId?: string | null;
  isNote?: boolean;
  isService?: boolean;
  sortOrder?: number;
}

export interface ConversionSource {
  documentId: string;
  documentNumber: string | null;
  documentType: DocumentType;
  lifecycle: Lifecycle;
  companyId: string;
  contactId: string;
  currency: string;
  issueDate?: Date | string | null;
  lines: ConvertibleLine[];
}

/** What the user ticked in the conversion dialog. Omit to take every remainder. */
export interface ConversionSelection {
  sourceDocumentId: string;
  sourceLineId: string;
  quantity: Numeric;
}

export type ConversionErrorCode =
  | 'NO_SOURCES'
  | 'SOURCE_NOT_VALIDATED'
  | 'ILLEGAL_TARGET'
  | 'MIXED_COMPANIES'
  | 'MIXED_CONTACTS'
  | 'MIXED_CURRENCIES'
  | 'UNKNOWN_LINE'
  | 'QUANTITY_EXCEEDS_REMAINDER'
  | 'NOTHING_TO_CONVERT';

export class ConversionError extends Error {
  constructor(
    readonly code: ConversionErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ConversionError';
  }
}

/** Quantity still available to pull downstream from this line. */
export function remainingQuantity(line: ConvertibleLine): string {
  const remaining = dec(line.quantity).minus(dec(line.drawnQuantity));
  return (remaining.isNegative() ? dec(0) : remaining).toFixed(6);
}

export function hasRemainder(line: ConvertibleLine): boolean {
  return dec(remainingQuantity(line)).gt(0);
}

export interface PlannedLine {
  description: string;
  variantId: string | null;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  discount: Discount | null;
  unitCost: string | null;
  warehouseId: string | null;
  isNote: boolean;
  isService: boolean;
  sortOrder: number;
  sources: Array<{
    sourceDocumentId: string;
    sourceDocumentType: DocumentType;
    sourceDocumentNumber: string | null;
    sourceLineId: string;
    quantity: string;
  }>;
}

export interface ConversionPlan {
  targetType: DocumentType;
  companyId: string;
  contactId: string;
  currency: string;
  sourceDocumentIds: string[];
  lines: PlannedLine[];
}

/**
 * Build the draft that a "Convert to ..." action opens.
 *
 * Accepts several sources at once, which is what makes "invoice these three
 * delivery notes as one invoice" work. Quantities default to each line's
 * remainder, so converting the same order twice picks up exactly where the
 * previous conversion stopped and over-delivery is impossible.
 */
export function planConversion(
  sources: ConversionSource[],
  targetType: DocumentType,
  selections?: ConversionSelection[],
): ConversionPlan {
  if (sources.length === 0) {
    throw new ConversionError('NO_SOURCES', 'At least one source document is required');
  }

  const first = sources[0]!;

  for (const source of sources) {
    if (!isLive(source.lifecycle)) {
      throw new ConversionError(
        'SOURCE_NOT_VALIDATED',
        `Document ${source.documentNumber ?? source.documentId} must be validated before conversion`,
        { documentId: source.documentId, lifecycle: source.lifecycle },
      );
    }
    if (!meta(source.documentType).convertsTo.includes(targetType)) {
      throw new ConversionError(
        'ILLEGAL_TARGET',
        `${source.documentType} cannot be converted to ${targetType}`,
        { documentId: source.documentId, from: source.documentType, to: targetType },
      );
    }
    if (source.companyId !== first.companyId) {
      throw new ConversionError('MIXED_COMPANIES', 'Sources belong to different companies');
    }
    if (source.contactId !== first.contactId) {
      throw new ConversionError(
        'MIXED_CONTACTS',
        'Sources belong to different clients or suppliers',
      );
    }
    if (source.currency !== first.currency) {
      throw new ConversionError('MIXED_CURRENCIES', 'Sources use different currencies');
    }
  }

  // Index selections by source line so we can validate each against its remainder.
  const wanted = new Map<string, { source: ConversionSource; line: ConvertibleLine; qty: string }>();

  if (selections && selections.length > 0) {
    for (const selection of selections) {
      const source = sources.find((s) => s.documentId === selection.sourceDocumentId);
      const line = source?.lines.find((l) => l.lineId === selection.sourceLineId);
      if (!source || !line) {
        throw new ConversionError('UNKNOWN_LINE', 'Selected line does not belong to any source', {
          selection,
        });
      }

      const requested = dec(selection.quantity);
      if (requested.lte(0)) continue;

      const remainder = dec(remainingQuantity(line));
      if (requested.gt(remainder)) {
        throw new ConversionError(
          'QUANTITY_EXCEEDS_REMAINDER',
          `Cannot take ${requested.toFixed()} of "${line.description}": only ${remainder.toFixed()} remain`,
          { sourceLineId: line.lineId, requested: requested.toFixed(), remaining: remainder.toFixed() },
        );
      }

      const key = `${source.documentId}::${line.lineId}`;
      const existing = wanted.get(key);
      const total = existing ? dec(existing.qty).plus(requested) : requested;
      if (total.gt(remainder)) {
        throw new ConversionError(
          'QUANTITY_EXCEEDS_REMAINDER',
          `Selections for "${line.description}" add up to more than the remaining quantity`,
          { sourceLineId: line.lineId },
        );
      }
      wanted.set(key, { source, line, qty: total.toFixed(6) });
    }
  } else {
    for (const source of sources) {
      for (const line of source.lines) {
        if (line.isNote) continue;
        if (!hasRemainder(line)) continue;
        wanted.set(`${source.documentId}::${line.lineId}`, {
          source,
          line,
          qty: remainingQuantity(line),
        });
      }
    }
  }

  if (wanted.size === 0) {
    throw new ConversionError(
      'NOTHING_TO_CONVERT',
      'Every line has already been fully converted downstream',
    );
  }

  let sortOrder = 0;
  const lines: PlannedLine[] = [...wanted.values()].map(({ source, line, qty }) => {
    sortOrder += 1;
    return {
      description: line.description,
      variantId: line.variantId,
      quantity: qty,
      unitPrice: dec(line.unitPrice).toFixed(6),
      vatRate: dec(line.vatRate).toFixed(2),
      discount: line.discount ?? null,
      unitCost: line.unitCost === null || line.unitCost === undefined ? null : dec(line.unitCost).toFixed(6),
      warehouseId: line.warehouseId ?? null,
      isNote: Boolean(line.isNote),
      isService: Boolean(line.isService),
      sortOrder,
      sources: [
        {
          sourceDocumentId: source.documentId,
          sourceDocumentType: source.documentType,
          sourceDocumentNumber: source.documentNumber,
          sourceLineId: line.lineId,
          quantity: qty,
        },
      ],
    };
  });

  return {
    targetType,
    companyId: first.companyId,
    contactId: first.contactId,
    currency: first.currency,
    sourceDocumentIds: [...new Set([...wanted.values()].map((w) => w.source.documentId))],
    lines,
  };
}

/**
 * Whether a validated document may still be cancelled.
 * Once something downstream has drawn from it, cancelling would leave the
 * downstream document referencing quantities that no longer exist.
 */
export function canCancel(lines: ConvertibleLine[]): boolean {
  return lines.every((line) => dec(line.drawnQuantity).lte(0));
}
