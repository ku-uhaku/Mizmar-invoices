import { z } from 'zod';
import { username as usernameSchema } from './auth';
import {
  currencyCode,
  decimalInput,
  decimalString,
  documentTypeEnum,
  localeEnum,
  negativeStockPolicyEnum,
  priceModeEnum,
  roleEnum,
  roundingGranularityEnum,
  roundingModeEnum,
  uuid,
} from './common';

// ---------------------------------------------------------------------------
// Company (legal entity)
// ---------------------------------------------------------------------------

export const company = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  legalName: z.string().nullable(),
  ice: z.string().nullable(),
  rc: z.string().nullable(),
  taxId: z.string().nullable(),
  patente: z.string().nullable(),
  cnss: z.string().nullable(),
  shareCapital: decimalString.nullable(),
  legalForm: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  phone2: z.string().nullable(),
  website: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
  bankName: z.string().nullable(),
  iban: z.string().nullable(),
  rib: z.string().nullable(),
  swift: z.string().nullable(),
  logoAssetId: uuid.nullable(),
  logoUrl: z.string().nullable(),
  defaultCurrency: z.string(),
  defaultLocale: localeEnum,
  priceMode: priceModeEnum,
  roundingMode: roundingModeEnum,
  roundingScale: z.number().int(),
  roundingGranularity: roundingGranularityEnum,
  negativeStockPolicy: negativeStockPolicyEnum,
  defaultWarehouseId: uuid.nullable(),
  isActive: z.boolean(),
});

export const companyUpdate = company
  .omit({ id: true, logoUrl: true, isActive: true })
  .partial();

export const companyCreate = companyUpdate.extend({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
});

export const vatRate = z.object({
  id: uuid,
  rate: decimalString,
  label: z.string(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});

export const vatRateInput = z.object({
  rate: decimalInput,
  label: z.string().min(1).max(50),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const numberSequence = z.object({
  /**
   * An opaque handle, not always a uuid: the settings screen lists every
   * document type, including ones that have issued nothing this year and so
   * have no row yet. Those carry a synthetic id the update endpoint accepts.
   */
  id: z.string(),
  type: documentTypeEnum,
  year: z.number().int(),
  prefix: z.string(),
  format: z.string(),
  counter: z.number().int(),
  /** What the next validated document of this type will be numbered. */
  nextNumberPreview: z.string(),
});

export const numberSequenceUpdate = z.object({
  prefix: z.string().min(1).max(10).optional(),
  /** Tokens: {PREFIX} {COMPANY} {YYYY} {YY} {MM} {SEQ} {SEQ:n} */
  format: z.string().min(1).max(60).optional(),
  /** Only allowed while the sequence has issued nothing this year. */
  counter: z.number().int().min(0).optional(),
});

export const membership = z.object({
  id: uuid,
  userId: uuid,
  email: z.string(),
  username: z.string().nullable(),
  fullName: z.string(),
  role: roleEnum,
  companyIds: z.array(uuid),
  isActive: z.boolean(),
  lastLoginAt: z.string().nullable(),
});

export const membershipInvite = z.object({
  email: z.string().email(),
  username: usernameSchema.optional(),
  fullName: z.string().min(1).max(200),
  role: roleEnum,
  companyIds: z.array(uuid).min(1),
  /** Temporary password; the invitee is asked to change it at first login. */
  password: z.string().min(8).max(200),
});

export const membershipUpdate = z.object({
  /** Empty string or null clears the username. */
  username: usernameSchema.or(z.literal('')).nullable().optional(),
  role: roleEnum.optional(),
  companyIds: z.array(uuid).optional(),
  isActive: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Document layout & style configurator
//
// This object is the entire contract between the configurator UI and the
// renderer. The web preview and the server PDF consume the same shape, which
// is what makes the preview honestly WYSIWYG.
// ---------------------------------------------------------------------------

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a hex colour like #1E3A8A');

export const templateBranding = z.object({
  logoAssetId: uuid.nullable().default(null),
  logoWidthMm: z.number().min(10).max(120).default(45),
  logoPosition: z.enum(['LEFT', 'CENTER', 'RIGHT']).default('LEFT'),
  headerLayout: z.enum(['LOGO_LEFT', 'LOGO_CENTER', 'BANNER', 'MINIMAL']).default('LOGO_LEFT'),
  stampAssetId: uuid.nullable().default(null),
  signatureAssetId: uuid.nullable().default(null),
  showStamp: z.boolean().default(false),
  showSignature: z.boolean().default(false),
});

export const templateColors = z.object({
  primary: hexColor.default('#1E3A8A'),
  accent: hexColor.default('#2563EB'),
  text: hexColor.default('#111827'),
  mutedText: hexColor.default('#6B7280'),
  border: hexColor.default('#E5E7EB'),
  tableHeaderBackground: hexColor.default('#1E3A8A'),
  tableHeaderText: hexColor.default('#FFFFFF'),
  zebraBackground: hexColor.default('#F9FAFB'),
  zebraStriping: z.boolean().default(true),
  totalsBackground: hexColor.default('#F3F4F6'),
});

export const templateTypography = z.object({
  headingFont: z.enum(['Inter', 'Roboto', 'Lato', 'Merriweather', 'NotoNaskhArabic']).default('Inter'),
  bodyFont: z.enum(['Inter', 'Roboto', 'Lato', 'Merriweather', 'NotoNaskhArabic']).default('Inter'),
  baseSizePt: z.number().min(6).max(14).default(9.5),
  lineHeight: z.number().min(1).max(2.2).default(1.45),
  headingScale: z.number().min(1).max(2.5).default(1.6),
});

export const templateLayout = z.object({
  pageSize: z.enum(['A4', 'LETTER']).default('A4'),
  orientation: z.enum(['PORTRAIT', 'LANDSCAPE']).default('PORTRAIT'),
  marginTopMm: z.number().min(5).max(40).default(14),
  marginRightMm: z.number().min(5).max(40).default(12),
  marginBottomMm: z.number().min(5).max(40).default(16),
  marginLeftMm: z.number().min(5).max(40).default(12),
  cornerRadiusPx: z.number().min(0).max(16).default(4),
});

/** Which line-item columns are printed, and how wide. */
export const templateColumns = z.object({
  showImage: z.boolean().default(false),
  showSku: z.boolean().default(true),
  showBarcode: z.boolean().default(false),
  showUnit: z.boolean().default(true),
  showLineDiscount: z.boolean().default(true),
  showVatPerLine: z.boolean().default(false),
  /** The "BL N° / date" column that consolidated invoices need. */
  showSourceReference: z.boolean().default(false),
  descriptionWidthPercent: z.number().min(20).max(70).default(42),
});

export const templateContent = z.object({
  showVatSummaryTable: z.boolean().default(true),
  showAmountInWords: z.boolean().default(true),
  showDepositAndBalance: z.boolean().default(true),
  showTermsAndConditions: z.boolean().default(true),
  showPaymentInstructions: z.boolean().default(true),
  showBankDetails: z.boolean().default(true),
  showLegalMentions: z.boolean().default(true),
  showContactTaxIds: z.boolean().default(true),
  showSignatureZones: z.boolean().default(false),
  footerText: z.string().max(2000).default(''),
  legalMentions: z.string().max(2000).default(''),
  paymentInstructions: z.string().max(2000).default(''),
  termsAndConditions: z.string().max(5000).default(''),
});

export const templateLocaleOptions = z.object({
  locale: localeEnum.default('FR'),
  /** Arabic templates mirror the whole layout, not just the text. */
  direction: z.enum(['AUTO', 'LTR', 'RTL']).default('AUTO'),
  currency: currencyCode.default('MAD'),
  currencySymbolPosition: z.enum(['BEFORE', 'AFTER']).default('AFTER'),
  dateFormat: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY', 'MM/DD/YYYY']).default('DD/MM/YYYY'),
  decimalSeparator: z.enum([',', '.']).default(','),
  thousandsSeparator: z.enum([' ', ',', '.', '']).default(' '),
  useArabicIndicDigits: z.boolean().default(false),
});

export const templatePagination = z.object({
  showPageNumbers: z.boolean().default(true),
  /** Rendered with the locale's wording, e.g. "Page 2 / 3". */
  pageNumberFormat: z.enum(['X_OF_Y', 'X_SLASH_Y', 'X_ONLY']).default('X_OF_Y'),
  pageNumberPosition: z.enum(['FOOTER_LEFT', 'FOOTER_CENTER', 'FOOTER_RIGHT']).default('FOOTER_RIGHT'),
  repeatTableHeader: z.boolean().default(true),
  /** Keep a line's rows together rather than splitting mid-item. */
  keepLineGroupsTogether: z.boolean().default(true),
  /** Never let the totals block separate from the table it totals. */
  keepTotalsWithTable: z.boolean().default(true),
  showContinuedMarker: z.boolean().default(true),
  minRowsOnLastPage: z.number().int().min(0).max(10).default(2),
});

export const templateConfigBody = z.object({
  branding: templateBranding.default({}),
  colors: templateColors.default({}),
  typography: templateTypography.default({}),
  layout: templateLayout.default({}),
  columns: templateColumns.default({}),
  content: templateContent.default({}),
  localeOptions: templateLocaleOptions.default({}),
  pagination: templatePagination.default({}),
});

export type TemplateConfigBody = z.infer<typeof templateConfigBody>;

export const templateConfig = z.object({
  /**
   * A uuid for a saved template, or the literal "default" for the built-in
   * one a company gets before it has saved any. Editing the built-in
   * materialises it as a real row.
   */
  id: z.string(),
  companyId: uuid,
  name: z.string(),
  /** Null means this template is the company default for every type. */
  documentType: documentTypeEnum.nullable(),
  isDefault: z.boolean(),
  version: z.number().int(),
  config: templateConfigBody,
});

export const templateConfigCreate = z.object({
  name: z.string().min(1).max(100),
  documentType: documentTypeEnum.nullish(),
  isDefault: z.boolean().default(false),
  config: templateConfigBody,
});

export const templateConfigUpdate = templateConfigCreate.partial();

/** Render the configurator preview without saving. */
export const templatePreviewRequest = z.object({
  config: templateConfigBody,
  /** Omit to render the built-in sample document. */
  documentId: uuid.nullish(),
  documentType: documentTypeEnum.default('SALES_INVOICE'),
  locale: localeEnum.optional(),
  /** Pad the sample out to this many lines to exercise pagination. */
  sampleLineCount: z.number().int().min(1).max(200).optional(),
});

export const templatePreviewResponse = z.object({
  html: z.string(),
  pageCountEstimate: z.number().int(),
});

export type Company = z.infer<typeof company>;
export type TemplateConfig = z.infer<typeof templateConfig>;
