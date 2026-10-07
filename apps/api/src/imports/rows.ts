/**
 * Row parsing and validation. Pure: no database access. Database duplicate
 * detection happens in the service; in-file duplicates are handled here.
 */
import {
  CONTACT_FIELDS,
  PRODUCT_FIELDS,
  mapHeaders,
  normalizeHeader,
  type ContactField,
  type HeaderMapping,
  type ProductField,
} from './columns';
import type { CsvRecord } from './csv';

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

/** Trim, collapse inner whitespace/control characters and NBSP. */
export function cleanText(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/ /g, ' ')
    .trim();
}

/** Single-line text: also collapses newlines and runs of spaces. */
export function cleanLine(value: string | undefined): string {
  return cleanText(value).replace(/\s+/g, ' ');
}

/**
 * Parse a decimal written the French or English way into a plain "1234.56".
 * Returns null when it is not a number. Accepts "1 234,56", "1.234,56",
 * "1,234.56", "12,5", "12.5 MAD", "20 %".
 */
export function parseDecimal(raw: string): string | null {
  let s = raw
    .replace(/[\s  ']/g, '')
    .replace(/(mad|dhs?|dirhams?|eur|usd|€|\$|%)/gi, '');
  if (s === '') return null;
  let sign = '';
  if (s.startsWith('-')) {
    sign = '-';
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart: string;
  let fracPart = '';

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    intPart = s.slice(0, decimalAt).replace(/[.,]/g, '');
    fracPart = s.slice(decimalAt + 1);
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sepChar = lastComma >= 0 ? ',' : '.';
    const count = s.split(sepChar).length - 1;
    const at = s.lastIndexOf(sepChar);
    if (count > 1) {
      // Repeated separator: it must be a thousands separator.
      if (/^\d{1,3}(?:[.,]\d{3})+$/.test(s)) intPart = s.replace(/[.,]/g, '');
      else return null;
    } else {
      intPart = s.slice(0, at);
      fracPart = s.slice(at + 1);
    }
  } else {
    intPart = s;
  }

  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (intPart === '' && fracPart === '') return null;
  const out = `${intPart || '0'}${fracPart ? `.${fracPart}` : ''}`;
  return `${sign}${out}`;
}

export function parseBoolean(raw: string): boolean | null {
  const v = normalizeHeader(raw);
  if (['1', 'oui', 'o', 'yes', 'y', 'true', 'vrai', 'x'].includes(v)) return true;
  if (['0', 'non', 'n', 'no', 'false', 'faux'].includes(v)) return false;
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ContactKind = 'CLIENT' | 'SUPPLIER' | 'BOTH';

export function parseContactKind(raw: string): ContactKind | null {
  const v = normalizeHeader(raw);
  if (['client', 'clients', 'customer', 'customers', 'c'].includes(v)) return 'CLIENT';
  if (['fournisseur', 'fournisseurs', 'supplier', 'suppliers', 'vendor', 'f', 's'].includes(v))
    return 'SUPPLIER';
  if (
    ['both', 'les deux', 'client fournisseur', 'client et fournisseur', 'client supplier', 'mixte', 'b'].includes(v)
  )
    return 'BOTH';
  return null;
}

export type PaymentTerm =
  | 'IMMEDIATE'
  | 'NET_15'
  | 'NET_30'
  | 'NET_45'
  | 'NET_60'
  | 'NET_90'
  | 'END_OF_MONTH'
  | 'END_OF_NEXT_MONTH'
  | 'CUSTOM';

export function parsePaymentTerm(raw: string): PaymentTerm | null {
  const v = normalizeHeader(raw);
  if (['immediate', 'comptant', 'a la commande', 'cash', 'immediat', 'reception'].includes(v))
    return 'IMMEDIATE';
  const days = /^(?:net )?(\d{1,3})(?: j| jours| days| jrs)?$/.exec(v);
  if (days) {
    const n = Number(days[1]);
    const table: Record<number, PaymentTerm> = {
      0: 'IMMEDIATE',
      15: 'NET_15',
      30: 'NET_30',
      45: 'NET_45',
      60: 'NET_60',
      90: 'NET_90',
    };
    return table[n] ?? null;
  }
  if (['end of month', 'fin de mois', 'fdm', 'eom'].includes(v)) return 'END_OF_MONTH';
  if (['end of next month', 'fin de mois suivant', '30 jours fin de mois', 'fin de mois prochain'].includes(v))
    return 'END_OF_NEXT_MONTH';
  if (['custom', 'personnalise', 'autre'].includes(v)) return 'CUSTOM';
  return null;
}

// ---------------------------------------------------------------------------
// Shared row shape
// ---------------------------------------------------------------------------

export interface RowIssue {
  row: number;
  /** Canonical field -> cleaned raw value (empty strings omitted). */
  values: Record<string, string>;
  errors: string[];
  warnings: string[];
}

export interface FileDuplicate {
  by: string;
  row: number;
  label: string;
}

function rowValues<F extends string>(
  record: CsvRecord,
  mapping: HeaderMapping<F>,
  multiline: F[] = [],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [field, idx] of mapping.index) {
    const raw = record.cells[idx];
    const v = multiline.includes(field) ? cleanText(raw) : cleanLine(raw);
    if (v !== '') values[field] = v;
  }
  return values;
}

function isBlank(record: CsvRecord): boolean {
  return record.cells.every((c) => cleanText(c) === '');
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ParsedProduct {
  sku: string;
  name: string;
  barcode?: string;
  productCode?: string;
  description?: string;
  category?: string;
  brand?: string;
  /** Unit code as written; resolved against the organization's units later. */
  unit?: string;
  vatRate?: string;
  costPrice?: string;
  sellingPrice?: string;
  minStock?: string;
  weightGrams?: number;
  isService?: boolean;
  openingStock?: string;
  warehouse?: string;
}

export interface ProductRow extends RowIssue {
  parsed: ParsedProduct | null;
  duplicateInFile: FileDuplicate | null;
}

export interface ProductRowsResult {
  mapping: HeaderMapping<ProductField>;
  rows: ProductRow[];
}

const COMMON_VAT = new Set(['0', '7', '10', '14', '20']);

export function validateProductRows(records: CsvRecord[]): ProductRowsResult {
  const [header, ...data] = records;
  const mapping = mapHeaders<ProductField>(header?.cells ?? [], PRODUCT_FIELDS);
  const rows: ProductRow[] = [];

  const seenSku = new Map<string, { row: number }>();
  const seenBarcode = new Map<string, { row: number }>();

  for (const record of data) {
    if (isBlank(record)) continue;
    const values = rowValues(record, mapping, ['description']);
    const errors: string[] = [];
    const warnings: string[] = [];
    const out: ParsedProduct = { sku: '', name: '' };

    if (record.cells.length > mapping.headers.length) {
      warnings.push('Extra values beyond the header columns were ignored');
    }

    out.name = values.name ?? '';
    if (!out.name) errors.push('Name is required');
    else if (out.name.length > 200) errors.push('Name is longer than 200 characters');

    out.sku = values.sku ?? '';
    if (!out.sku && values.barcode) {
      out.sku = values.barcode;
      warnings.push('No SKU: the barcode is used as SKU');
    }
    if (!out.sku) errors.push('SKU is required');
    else if (out.sku.length > 64) errors.push('SKU is longer than 64 characters');

    if (values.barcode) {
      if (values.barcode.length > 64) errors.push('Barcode is longer than 64 characters');
      else out.barcode = values.barcode;
    }
    if (values.productCode) {
      if (values.productCode.length > 64) errors.push('Product code is longer than 64 characters');
      else out.productCode = values.productCode;
    }
    if (values.description) {
      if (values.description.length > 5000) errors.push('Description is longer than 5000 characters');
      else out.description = values.description;
    }
    for (const f of ['category', 'brand'] as const) {
      if (values[f]) {
        if (values[f]!.length > 100) errors.push(`${f} is longer than 100 characters`);
        else out[f] = values[f];
      }
    }
    if (values.unit) out.unit = values.unit;
    if (values.warehouse) out.warehouse = values.warehouse;

    const decimal = (
      field: 'vatRate' | 'costPrice' | 'sellingPrice' | 'minStock' | 'openingStock',
      label: string,
      opts: { allowNegative?: boolean } = {},
    ) => {
      const raw = values[field];
      if (raw === undefined) return;
      const parsed = parseDecimal(raw);
      if (parsed === null) errors.push(`${label} "${raw}" is not a number`);
      else if (!opts.allowNegative && parsed.startsWith('-')) errors.push(`${label} must not be negative`);
      else if (parsed.length > 18) errors.push(`${label} is too large`);
      else out[field] = parsed;
    };
    decimal('vatRate', 'VAT');
    decimal('costPrice', 'Cost price');
    decimal('sellingPrice', 'Selling price');
    decimal('minStock', 'Minimum stock');
    decimal('openingStock', 'Opening stock');

    if (out.vatRate !== undefined) {
      const n = Number(out.vatRate);
      if (n > 100) errors.push('VAT must be between 0 and 100');
      else if (!COMMON_VAT.has(String(n))) warnings.push(`Unusual VAT rate ${out.vatRate}%`);
    }

    if (values.weight !== undefined) {
      const w = parseDecimal(values.weight);
      if (w === null || w.startsWith('-')) errors.push(`Weight "${values.weight}" is not valid`);
      else out.weightGrams = Math.round(Number(w));
    }

    if (values.isService !== undefined) {
      const b = parseBoolean(values.isService);
      if (b === null) errors.push(`Service "${values.isService}" must be yes/no`);
      else out.isService = b;
    }

    if (out.openingStock !== undefined && out.isService) {
      warnings.push('Opening stock ignored for a service');
    }

    // In-file duplicates.
    const dups: FileDuplicate[] = [];
    if (out.sku) {
      const key = out.sku.toLowerCase();
      const prior = seenSku.get(key);
      if (prior) dups.push({ by: 'sku', row: prior.row, label: out.sku });
      else seenSku.set(key, { row: record.line });
    }
    if (out.barcode) {
      const key = out.barcode.toLowerCase();
      const prior = seenBarcode.get(key);
      if (prior) dups.push({ by: 'barcode', row: prior.row, label: out.barcode });
      else seenBarcode.set(key, { row: record.line });
    }
    const duplicateInFile = dups[0] ?? null;

    rows.push({
      row: record.line,
      values,
      errors,
      warnings,
      parsed: errors.length === 0 ? out : null,
      duplicateInFile,
    });
  }

  return { mapping, rows };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export interface ParsedContact {
  kind: ContactKind;
  /** True when the kind came from the file rather than the default. */
  kindGiven: boolean;
  displayName: string;
  code?: string;
  legalName?: string;
  ice?: string;
  rc?: string;
  taxId?: string;
  patente?: string;
  email?: string;
  phone?: string;
  phone2?: string;
  website?: string;
  paymentTerm?: PaymentTerm;
  paymentTermDays?: number;
  creditLimit?: string;
  currency?: string;
  vatExempt?: boolean;
  notes?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

export interface ContactRow extends RowIssue {
  parsed: ParsedContact | null;
  duplicateInFile: FileDuplicate | null;
}

export interface ContactRowsResult {
  mapping: HeaderMapping<ContactField>;
  rows: ContactRow[];
}

/** Digits only, for ICE / tax id comparison ("001 234 567" == "001234567"). */
export function normalizeId(value: string): string {
  return value.replace(/[\s.\-/]/g, '').toLowerCase();
}

export function normalizeName(value: string): string {
  return normalizeHeader(value);
}

export function validateContactRows(
  records: CsvRecord[],
  defaultKind: ContactKind = 'CLIENT',
): ContactRowsResult {
  const [header, ...data] = records;
  const mapping = mapHeaders<ContactField>(header?.cells ?? [], CONTACT_FIELDS);
  const rows: ContactRow[] = [];

  const seen: Record<'ice' | 'taxId' | 'email' | 'name', Map<string, number>> = {
    ice: new Map(),
    taxId: new Map(),
    email: new Map(),
    name: new Map(),
  };

  for (const record of data) {
    if (isBlank(record)) continue;
    const values = rowValues(record, mapping, ['notes']);
    const errors: string[] = [];
    const warnings: string[] = [];
    const out: ParsedContact = { kind: defaultKind, kindGiven: false, displayName: '' };

    if (record.cells.length > mapping.headers.length) {
      warnings.push('Extra values beyond the header columns were ignored');
    }

    out.displayName = values.displayName ?? '';
    if (!out.displayName) errors.push('Name is required');
    else if (out.displayName.length > 200) errors.push('Name is longer than 200 characters');

    if (values.kind !== undefined) {
      const kind = parseContactKind(values.kind);
      if (!kind) errors.push(`Type "${values.kind}" must be client, supplier or both`);
      else {
        out.kind = kind;
        out.kindGiven = true;
      }
    }

    const text = (field: 'code' | 'legalName' | 'ice' | 'rc' | 'taxId' | 'patente' | 'phone' | 'phone2', max: number) => {
      const v = values[field];
      if (v === undefined) return;
      if (v.length > max) errors.push(`${field} is longer than ${max} characters`);
      else out[field] = v;
    };
    text('code', 40);
    text('legalName', 200);
    text('ice', 40);
    text('rc', 40);
    text('taxId', 40);
    text('patente', 40);
    text('phone', 40);
    text('phone2', 40);

    if (out.ice && !/^\d{15}$/.test(normalizeId(out.ice))) {
      warnings.push('ICE normally has 15 digits');
    }

    if (values.email !== undefined) {
      const email = values.email.toLowerCase();
      if (!EMAIL_RE.test(email)) errors.push(`Email "${values.email}" is not valid`);
      else out.email = email;
    }
    if (values.website !== undefined) {
      if (values.website.length > 200) errors.push('Website is longer than 200 characters');
      else out.website = values.website;
    }
    if (values.notes !== undefined) {
      if (values.notes.length > 5000) errors.push('Notes are longer than 5000 characters');
      else out.notes = values.notes;
    }

    if (values.paymentTerm !== undefined) {
      const term = parsePaymentTerm(values.paymentTerm);
      if (!term) errors.push(`Payment terms "${values.paymentTerm}" not recognised`);
      else out.paymentTerm = term;
    }
    if (values.paymentTermDays !== undefined) {
      const d = parseDecimal(values.paymentTermDays);
      const n = d === null ? NaN : Number(d);
      if (!Number.isInteger(n) || n < 0 || n > 365) errors.push('Payment days must be 0 to 365');
      else out.paymentTermDays = n;
    }
    if (values.creditLimit !== undefined) {
      const d = parseDecimal(values.creditLimit);
      if (d === null || d.startsWith('-')) errors.push(`Credit limit "${values.creditLimit}" is not valid`);
      else out.creditLimit = d;
    }
    if (values.currency !== undefined) {
      const cur = values.currency.toUpperCase().replace(/^DHS?$/, 'MAD');
      if (!/^[A-Z]{3}$/.test(cur)) errors.push(`Currency "${values.currency}" must be a 3-letter code`);
      else out.currency = cur;
    }
    if (values.vatExempt !== undefined) {
      const b = parseBoolean(values.vatExempt);
      if (b === null) errors.push(`VAT exempt "${values.vatExempt}" must be yes/no`);
      else out.vatExempt = b;
    }

    for (const f of ['address', 'city', 'postalCode'] as const) {
      if (values[f] !== undefined) out[f] = values[f];
    }
    if (values.country !== undefined) out.country = values.country;
    if (out.address && out.address.length > 300) errors.push('Address is too long');
    if ((out.city || out.postalCode) && !out.address) {
      warnings.push('City / postal code ignored without an address');
    }

    const dups: FileDuplicate[] = [];
    const check = (kind: 'ice' | 'taxId' | 'email' | 'name', key: string | undefined, label: string) => {
      if (!key) return;
      const prior = seen[kind].get(key);
      if (prior !== undefined) dups.push({ by: kind, row: prior, label });
      else seen[kind].set(key, record.line);
    };
    check('ice', out.ice ? normalizeId(out.ice) : undefined, out.ice ?? '');
    check('taxId', out.taxId ? normalizeId(out.taxId) : undefined, out.taxId ?? '');
    check('email', out.email, out.email ?? '');
    check('name', out.displayName ? normalizeName(out.displayName) : undefined, out.displayName);
    const duplicateInFile = dups[0] ?? null;

    rows.push({
      row: record.line,
      values,
      errors,
      warnings,
      parsed: errors.length === 0 ? out : null,
      duplicateInFile,
    });
  }

  return { mapping, rows };
}
