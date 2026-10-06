/** The eight commercial documents, sales side then purchase side. */
export const DOCUMENT_TYPES = [
  'DEVIS',
  'SALES_ORDER',
  'DELIVERY_NOTE',
  'SALES_INVOICE',
  'CREDIT_NOTE',
  'PURCHASE_ORDER',
  'GOODS_RECEIPT',
  'PURCHASE_INVOICE',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type DocumentSide = 'SALES' | 'PURCHASE';

/** Direction a document pushes physical stock when it is validated. */
export type StockDirection = 'IN' | 'OUT';

export const LIFECYCLE_STATES = ['DRAFT', 'VALIDATED', 'SENT', 'CANCELLED'] as const;
export type Lifecycle = (typeof LIFECYCLE_STATES)[number];

export const FULFILMENT_STATES = ['NOT_APPLICABLE', 'PENDING', 'PARTIAL', 'COMPLETE'] as const;
export type Fulfilment = (typeof FULFILMENT_STATES)[number];

export const SETTLEMENT_STATES = ['NOT_APPLICABLE', 'UNPAID', 'PARTIAL', 'PAID'] as const;
export type Settlement = (typeof SETTLEMENT_STATES)[number];

export interface DocumentTypeMeta {
  type: DocumentType;
  side: DocumentSide;
  /** Default numbering prefix; a company may override it. */
  prefix: string;
  /** Writes stock ledger rows on validation. */
  movesStock: boolean;
  /** Direction of those ledger rows. */
  stockDirection: StockDirection | null;
  /** Holds stock without moving it (sales order) or expects it (purchase order). */
  reserves: StockDirection | null;
  /** Participates in receivables/payables, so it carries a settlement status. */
  settles: boolean;
  /** Carries a due date derived from the contact's payment terms. */
  hasDueDate: boolean;
  /** Carries a validity window instead of a due date. */
  hasValidityDate: boolean;
  /** Document types this one can be converted into. */
  convertsTo: readonly DocumentType[];
}

export const DOCUMENT_META: Record<DocumentType, DocumentTypeMeta> = {
  DEVIS: {
    type: 'DEVIS',
    side: 'SALES',
    prefix: 'DV',
    movesStock: false,
    stockDirection: null,
    reserves: null,
    settles: false,
    hasDueDate: false,
    hasValidityDate: true,
    convertsTo: ['SALES_ORDER', 'DELIVERY_NOTE', 'SALES_INVOICE'],
  },
  SALES_ORDER: {
    type: 'SALES_ORDER',
    side: 'SALES',
    prefix: 'BC',
    movesStock: false,
    stockDirection: null,
    reserves: 'OUT',
    settles: false,
    hasDueDate: false,
    hasValidityDate: false,
    convertsTo: ['DELIVERY_NOTE', 'SALES_INVOICE'],
  },
  DELIVERY_NOTE: {
    type: 'DELIVERY_NOTE',
    side: 'SALES',
    prefix: 'BL',
    movesStock: true,
    stockDirection: 'OUT',
    reserves: null,
    settles: false,
    hasDueDate: false,
    hasValidityDate: false,
    convertsTo: ['SALES_INVOICE'],
  },
  SALES_INVOICE: {
    type: 'SALES_INVOICE',
    side: 'SALES',
    prefix: 'FA',
    movesStock: true,
    stockDirection: 'OUT',
    reserves: null,
    settles: true,
    hasDueDate: true,
    hasValidityDate: false,
    convertsTo: ['CREDIT_NOTE'],
  },
  CREDIT_NOTE: {
    type: 'CREDIT_NOTE',
    side: 'SALES',
    prefix: 'AV',
    movesStock: true,
    stockDirection: 'IN',
    reserves: null,
    settles: true,
    hasDueDate: false,
    hasValidityDate: false,
    convertsTo: [],
  },
  PURCHASE_ORDER: {
    type: 'PURCHASE_ORDER',
    side: 'PURCHASE',
    prefix: 'BCF',
    movesStock: false,
    stockDirection: null,
    reserves: 'IN',
    settles: false,
    hasDueDate: false,
    hasValidityDate: false,
    convertsTo: ['GOODS_RECEIPT', 'PURCHASE_INVOICE'],
  },
  GOODS_RECEIPT: {
    type: 'GOODS_RECEIPT',
    side: 'PURCHASE',
    prefix: 'BR',
    movesStock: true,
    stockDirection: 'IN',
    reserves: null,
    settles: false,
    hasDueDate: false,
    hasValidityDate: false,
    convertsTo: ['PURCHASE_INVOICE'],
  },
  PURCHASE_INVOICE: {
    type: 'PURCHASE_INVOICE',
    side: 'PURCHASE',
    prefix: 'FF',
    movesStock: true,
    stockDirection: 'IN',
    reserves: null,
    settles: true,
    hasDueDate: true,
    hasValidityDate: false,
    convertsTo: [],
  },
};

export function meta(type: DocumentType): DocumentTypeMeta {
  const m = DOCUMENT_META[type];
  if (!m) throw new Error(`Unknown document type: ${type}`);
  return m;
}

export function isSales(type: DocumentType): boolean {
  return meta(type).side === 'SALES';
}

export function movesStock(type: DocumentType): boolean {
  return meta(type).movesStock;
}

/** Types that should appear in the "Convert to" menu of a validated document. */
export function conversionTargets(type: DocumentType): readonly DocumentType[] {
  return meta(type).convertsTo;
}
