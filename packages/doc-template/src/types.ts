import type { TemplateConfigBody } from '@mizmar/contracts';
import type { Locale } from '@mizmar/i18n';

export type { TemplateConfigBody, Locale };

export interface RenderAddress {
  addressLine1: string;
  addressLine2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface RenderCompany {
  name: string;
  legalName?: string | null;
  legalForm?: string | null;
  ice?: string | null;
  rc?: string | null;
  taxId?: string | null;
  patente?: string | null;
  cnss?: string | null;
  shareCapital?: string | null;
  email?: string | null;
  phone?: string | null;
  phone2?: string | null;
  website?: string | null;
  address?: RenderAddress | null;
  bankName?: string | null;
  iban?: string | null;
  rib?: string | null;
  swift?: string | null;
  logoUrl?: string | null;
  stampUrl?: string | null;
  signatureUrl?: string | null;
}

export interface RenderContact {
  displayName: string;
  legalName?: string | null;
  ice?: string | null;
  rc?: string | null;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress?: RenderAddress | null;
  shippingAddress?: RenderAddress | null;
  paymentTermLabel?: string | null;
}

export interface RenderLine {
  sku?: string | null;
  barcode?: string | null;
  description: string;
  variantLabel?: string | null;
  unitCode?: string | null;
  imageUrl?: string | null;
  /** Decimal strings throughout; the renderer formats, it never computes. */
  quantity: string;
  unitPrice: string;
  discountKind?: 'PERCENT' | 'AMOUNT' | null;
  discountValue?: string | null;
  lineDiscount: string;
  vatRate: string;
  vatAmount: string;
  taxableBase: string;
  lineTotal: string;
  /** Upstream delivery-note number, for a consolidated invoice. */
  sourceReference?: string | null;
  /** A heading or free-text line: printed, but carries no money. */
  isNote?: boolean;
}

export interface RenderVatBucket {
  rate: string;
  base: string;
  amount: string;
}

export interface RenderTotals {
  subtotalGross: string;
  totalLineDiscounts: string;
  subtotalNet: string;
  globalDiscount: string;
  shippingNet: string;
  totalExclVat: string;
  totalVat: string;
  totalInclVat: string;
  vatBuckets: RenderVatBucket[];
}

export interface RenderDocument {
  type:
    | 'DEVIS'
    | 'SALES_ORDER'
    | 'DELIVERY_NOTE'
    | 'SALES_INVOICE'
    | 'CREDIT_NOTE'
    | 'PURCHASE_ORDER'
    | 'GOODS_RECEIPT'
    | 'PURCHASE_INVOICE';
  number?: string | null;
  issueDate: string;
  dueDate?: string | null;
  validUntil?: string | null;
  deliveryDate?: string | null;
  reference?: string | null;
  projectName?: string | null;
  currency: string;
  notes?: string | null;
  terms?: string | null;
  paidAmount?: string | null;
  outstandingAmount?: string | null;
  lines: RenderLine[];
  totals: RenderTotals;
}

export interface RenderData {
  company: RenderCompany;
  contact: RenderContact;
  document: RenderDocument;
  warehouseName?: string | null;
  salespersonName?: string | null;
  /** Watermark, e.g. DRAFT or CANCELLED. */
  watermark?: string | null;
}

export interface RenderOptions {
  /**
   * `@font-face` rules to inline. The API passes base64-embedded fonts so
   * Chromium renders identically with no network; the web preview passes
   * nothing and relies on the Google Fonts link.
   */
  fontCss?: string;
  /**
   * True when Chromium will draw its own header/footer (`displayHeaderFooter`),
   * so the in-body preview footer is suppressed.
   */
  forPdf?: boolean;
  /** Page count shown in the preview footer, since an iframe cannot paginate. */
  estimatedPageCount?: number;
}
