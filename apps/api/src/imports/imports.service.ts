import { Injectable } from '@nestjs/common';
import type { importSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { CatalogService } from '../catalog/catalog.service';
import { ContactsService } from '../contacts/contacts.service';
import { CsvError, parseCsv, type CsvResult } from './csv';
import {
  normalizeId,
  normalizeName,
  validateContactRows,
  validateProductRows,
  type ContactKind,
  type ContactRow,
  type ParsedProduct,
  type ProductRow,
} from './rows';
import { contactTemplate, productTemplate } from './templates';

type Kind = z.infer<typeof importSchemas.importKind>;
type PreviewRequest = z.infer<typeof importSchemas.importPreviewRequest>;
type CommitRequest = z.infer<typeof importSchemas.importCommitRequest>;
type PreviewResponse = z.infer<typeof importSchemas.importPreviewResponse>;
type CommitResponse = z.infer<typeof importSchemas.importCommitResponse>;
type RowResult = CommitResponse['results'][number];
type Duplicate = z.infer<typeof importSchemas.importDuplicate>;

/** Rows are written in sequential batches so a large file never holds one giant transaction. */
const BATCH_SIZE = 500;

interface DbDuplicate extends Duplicate {
  /** Catalog: the owning product id, needed to update the variant. */
  productId?: string;
}

interface Plan<R> {
  response: PreviewResponse;
  rows: R[];
  /** Row number -> duplicate found in the database. */
  dbDuplicates: Map<number, DbDuplicate>;
  warehouses: { id: string; code: string; name: string }[];
  units: { id: string; code: string }[];
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly contacts: ContactsService,
  ) {}

  template(ctx: RequestContext, kind: Kind, lang: 'fr' | 'en') {
    this.assertCan(ctx, kind);
    return {
      filename: `${kind === 'products' ? 'produits' : 'tiers'}-modele-${lang}.csv`,
      csv: kind === 'products' ? productTemplate(lang) : contactTemplate(lang),
    };
  }

  async preview(ctx: RequestContext, kind: Kind, body: PreviewRequest): Promise<PreviewResponse> {
    this.assertCan(ctx, kind);
    if (kind === 'products') return (await this.planProducts(ctx, body)).response;
    return (await this.planContacts(ctx, body)).response;
  }

  async commit(ctx: RequestContext, kind: Kind, body: CommitRequest): Promise<CommitResponse> {
    this.assertCan(ctx, kind);
    return kind === 'products' ? this.commitProducts(ctx, body) : this.commitContacts(ctx, body);
  }

  // =========================================================================
  // Shared
  // =========================================================================

  private assertCan(ctx: RequestContext, kind: Kind): void {
    const ok =
      kind === 'products'
        ? ctx.ability.can('manage', 'Product') || ctx.ability.can('create', 'Product')
        : ctx.ability.can('create', 'Contact');
    if (!ok) throw AppError.forbidden('Your role may not import this data');
  }

  private parse(body: PreviewRequest): CsvResult {
    try {
      return parseCsv(body.csv, { delimiter: body.delimiter });
    } catch (error) {
      if (error instanceof CsvError) {
        const code =
          error.code === 'TOO_LARGE'
            ? 'IMPORT_TOO_LARGE'
            : error.code === 'TOO_MANY_ROWS'
              ? 'IMPORT_TOO_MANY_ROWS'
              : 'IMPORT_INVALID_CSV';
        throw AppError.unprocessable(
          code,
          error.line ? `${error.message} (line ${error.line})` : error.message,
        );
      }
      throw error;
    }
  }

  private summarize<R extends ProductRow | ContactRow>(
    kind: Kind,
    csv: CsvResult,
    mapping: { headers: { header: string; field: string | null }[]; missingRequired: string[] },
    rows: R[],
    dbDuplicates: Map<number, DbDuplicate>,
  ): PreviewResponse {
    const out = rows.map((r) => {
      const db = dbDuplicates.get(r.row);
      const duplicate: Duplicate | null = db
        ? { by: db.by, existingId: db.existingId, label: db.label, source: 'database', row: null }
        : r.duplicateInFile
          ? {
              by: r.duplicateInFile.by,
              existingId: null,
              label: r.duplicateInFile.label,
              source: 'file',
              row: r.duplicateInFile.row,
            }
          : null;
      return { row: r.row, values: r.values, errors: r.errors, warnings: r.warnings, duplicate };
    });
    return {
      kind,
      delimiter: csv.delimiter,
      headers: mapping.headers,
      missingRequired: mapping.missingRequired,
      totalRows: out.length,
      validRows: out.filter((r) => r.errors.length === 0 && !r.duplicate).length,
      errorRows: out.filter((r) => r.errors.length > 0).length,
      duplicateRows: out.filter((r) => r.duplicate).length,
      rows: out,
    };
  }

  private missingColumnsPlan(
    mapping: { missingRequired: string[] },
    rows: { errors: string[] }[],
  ): void {
    if (mapping.missingRequired.length === 0) return;
    for (const row of rows) {
      row.errors.unshift(`Missing required column: ${mapping.missingRequired.join(', ')}`);
    }
  }

  // =========================================================================
  // Products
  // =========================================================================

  private async planProducts(
    ctx: RequestContext,
    body: PreviewRequest,
  ): Promise<Plan<ProductRow>> {
    const csv = this.parse(body);
    const { mapping, rows } = validateProductRows(csv.records);
    this.missingColumnsPlan(mapping, rows);

    const [warehouses, units] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { organizationId: ctx.organizationId, isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.unit.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true, code: true },
      }),
    ]);

    // Reference data checks.
    for (const row of rows) {
      const p = row.parsed;
      if (!p) continue;
      if (p.unit && !units.some((u) => u.code.toLowerCase() === p.unit!.toLowerCase())) {
        row.warnings.push(`Unit "${p.unit}" not found: the product gets no unit`);
      }
      const wantsStock = p.openingStock !== undefined && Number(p.openingStock) !== 0 && !p.isService;
      if (wantsStock && !this.resolveWarehouse(p, warehouses)) {
        row.errors.push(
          p.warehouse
            ? `Warehouse "${p.warehouse}" not found`
            : 'Opening stock needs a warehouse (several exist)',
        );
        row.parsed = null;
      }
    }

    const dbDuplicates = await this.findProductDuplicates(ctx, rows);
    return {
      response: this.summarize('products', csv, mapping, rows, dbDuplicates),
      rows,
      dbDuplicates,
      warehouses,
      units,
    };
  }

  private resolveWarehouse(
    p: ParsedProduct,
    warehouses: { id: string; code: string; name: string }[],
  ): { id: string } | null {
    if (p.warehouse) {
      const needle = p.warehouse.toLowerCase();
      return (
        warehouses.find((w) => w.code.toLowerCase() === needle || w.name.toLowerCase() === needle) ??
        null
      );
    }
    return warehouses.length === 1 ? warehouses[0]! : null;
  }

  private async findProductDuplicates(
    ctx: RequestContext,
    rows: ProductRow[],
  ): Promise<Map<number, DbDuplicate>> {
    const skus = new Set<string>();
    const barcodes = new Set<string>();
    for (const r of rows) {
      if (r.values.sku) skus.add(r.values.sku);
      if (r.values.barcode) barcodes.add(r.values.barcode);
      if (r.parsed?.sku) skus.add(r.parsed.sku);
    }

    const found: {
      id: string;
      sku: string;
      barcode: string | null;
      productId: string;
      product: { name: string };
    }[] = [];
    const chunk = <T>(set: Set<T>) => {
      const all = [...set];
      const out: T[][] = [];
      for (let i = 0; i < all.length; i += 1000) out.push(all.slice(i, i + 1000));
      return out;
    };
    for (const part of chunk(skus)) {
      found.push(
        ...(await this.prisma.productVariant.findMany({
          where: { product: { organizationId: ctx.organizationId }, sku: { in: part } },
          select: { id: true, sku: true, barcode: true, productId: true, product: { select: { name: true } } },
        })),
      );
    }
    for (const part of chunk(barcodes)) {
      found.push(
        ...(await this.prisma.productVariant.findMany({
          where: { product: { organizationId: ctx.organizationId }, barcode: { in: part } },
          select: { id: true, sku: true, barcode: true, productId: true, product: { select: { name: true } } },
        })),
      );
    }

    const bySku = new Map(found.map((v) => [v.sku.toLowerCase(), v]));
    const byBarcode = new Map(
      found.filter((v) => v.barcode).map((v) => [v.barcode!.toLowerCase(), v]),
    );

    const result = new Map<number, DbDuplicate>();
    for (const r of rows) {
      const sku = (r.parsed?.sku ?? r.values.sku ?? '').toLowerCase();
      const barcode = (r.values.barcode ?? '').toLowerCase();
      const hit = bySku.get(sku);
      const hitBarcode = barcode ? byBarcode.get(barcode) : undefined;
      if (hit) {
        result.set(r.row, {
          by: 'sku',
          existingId: hit.id,
          productId: hit.productId,
          label: `${hit.sku} · ${hit.product.name}`,
          source: 'database',
          row: null,
        });
      } else if (hitBarcode) {
        result.set(r.row, {
          by: 'barcode',
          existingId: hitBarcode.id,
          productId: hitBarcode.productId,
          label: `${hitBarcode.sku} · ${hitBarcode.product.name}`,
          source: 'database',
          row: null,
        });
      }
    }
    return result;
  }

  private async commitProducts(ctx: RequestContext, body: CommitRequest): Promise<CommitResponse> {
    const plan = await this.planProducts(ctx, body);
    const results: RowResult[] = [];
    const unitId = (code?: string) =>
      code ? plan.units.find((u) => u.code.toLowerCase() === code.toLowerCase())?.id : undefined;

    type Create = { row: ProductRow; p: ParsedProduct };
    const groups = new Map<string, Create[]>();
    const updates: Create[] = [];

    for (const row of plan.rows) {
      const db = plan.dbDuplicates.get(row.row);
      if (row.errors.length > 0 || !row.parsed) {
        results.push({ row: row.row, status: 'failed', message: row.errors.join('; ') });
      } else if (row.duplicateInFile) {
        results.push({
          row: row.row,
          status: 'skipped',
          message: `Duplicate ${row.duplicateInFile.by} of row ${row.duplicateInFile.row}`,
        });
      } else if (db) {
        if (body.mode === 'update') updates.push({ row, p: row.parsed });
        else results.push({ row: row.row, status: 'skipped', message: `Already exists (${db.by}: ${db.label})` });
      } else {
        // Rows sharing a product code and name become variants of one product.
        const key = row.parsed.productCode
          ? `${row.parsed.productCode.toLowerCase()}|${row.parsed.name.toLowerCase()}`
          : `row:${row.row}`;
        const list = groups.get(key) ?? [];
        list.push({ row, p: row.parsed });
        groups.set(key, list);
      }
    }

    const work: (() => Promise<void>)[] = [];

    for (const members of groups.values()) {
      work.push(async () => {
        const first = members[0]!.p;
        try {
          const variants = members.map(({ p }) => {
            const wh = p.openingStock && !p.isService ? this.resolveWarehouse(p, plan.warehouses) : null;
            return {
              sku: p.sku,
              ...(p.barcode ? { barcode: p.barcode } : {}),
              attributeValueIds: [] as string[],
              costPrice: p.costPrice ?? '0',
              sellingPrice: p.sellingPrice ?? '0',
              minStockThreshold: p.minStock ?? '0',
              ...(p.weightGrams !== undefined ? { weightGrams: p.weightGrams } : {}),
              ...(wh && Number(p.openingStock) !== 0
                ? { openingStock: [{ warehouseId: wh.id, quantity: p.openingStock! }] }
                : {}),
              isActive: true,
            };
          });
          await this.catalog.createProduct(ctx, {
            name: first.name,
            ...(first.productCode ? { reference: first.productCode } : {}),
            ...(first.description ? { description: first.description } : {}),
            ...(first.category ? { category: first.category } : {}),
            ...(first.brand ? { brand: first.brand } : {}),
            ...(unitId(first.unit) ? { unitId: unitId(first.unit)! } : {}),
            defaultVatRate: first.vatRate ?? '20',
            isVariantManaged: members.length > 1,
            isService: first.isService ?? false,
            attributeTypeIds: [],
            variants,
          });
          for (const m of members) results.push({ row: m.row.row, status: 'created', message: null });
        } catch (error) {
          for (const m of members) {
            results.push({ row: m.row.row, status: 'failed', message: errorMessage(error) });
          }
        }
      });
    }

    for (const { row, p } of updates) {
      work.push(async () => {
        try {
          await this.updateProductRow(ctx, plan.dbDuplicates.get(row.row)!, p, unitId(p.unit));
          results.push({ row: row.row, status: 'updated', message: null });
        } catch (error) {
          results.push({ row: row.row, status: 'failed', message: errorMessage(error) });
        }
      });
    }

    await runInBatches(work);
    return tally(results);
  }

  /** Update one variant (and its product) with only the columns the file provided. */
  private async updateProductRow(
    ctx: RequestContext,
    dup: DbDuplicate,
    p: ParsedProduct,
    unitId: string | undefined,
  ): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: dup.productId!, organizationId: ctx.organizationId },
      include: { variants: true },
    });
    if (!product) throw AppError.notFound('Product', dup.productId);

    // updateProduct deactivates variants that are not resubmitted, so every
    // sibling is passed back unchanged.
    const variants = product.variants.map((v) => {
      const base = {
        id: v.id,
        sku: v.sku,
        ...(v.barcode ? { barcode: v.barcode } : {}),
        attributeValueIds: [] as string[],
        costPrice: v.costPrice.toFixed(),
        sellingPrice: v.sellingPrice.toFixed(),
        minStockThreshold: v.minStockThreshold.toFixed(),
        ...(v.weightGrams !== null ? { weightGrams: v.weightGrams } : {}),
        isActive: v.isActive,
      };
      if (v.id !== dup.existingId) return base;
      return {
        ...base,
        ...(p.barcode ? { barcode: p.barcode } : {}),
        ...(p.costPrice !== undefined ? { costPrice: p.costPrice } : {}),
        ...(p.sellingPrice !== undefined ? { sellingPrice: p.sellingPrice } : {}),
        ...(p.minStock !== undefined ? { minStockThreshold: p.minStock } : {}),
        ...(p.weightGrams !== undefined ? { weightGrams: p.weightGrams } : {}),
      };
    });

    await this.catalog.updateProduct(ctx, product.id, {
      name: p.name,
      ...(p.description ? { description: p.description } : {}),
      ...(p.category ? { category: p.category } : {}),
      ...(p.brand ? { brand: p.brand } : {}),
      ...(unitId ? { unitId } : {}),
      ...(p.vatRate !== undefined ? { defaultVatRate: p.vatRate } : {}),
      variants,
    });
  }

  // =========================================================================
  // Contacts
  // =========================================================================

  private async planContacts(
    ctx: RequestContext,
    body: PreviewRequest,
  ): Promise<Plan<ContactRow>> {
    const csv = this.parse(body);
    const { mapping, rows } = validateContactRows(csv.records, body.defaultKind ?? 'CLIENT');
    this.missingColumnsPlan(mapping, rows);

    const existing = await this.prisma.contact.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, displayName: true, ice: true, taxId: true, email: true },
    });
    const index = {
      ice: new Map<string, (typeof existing)[number]>(),
      taxId: new Map<string, (typeof existing)[number]>(),
      email: new Map<string, (typeof existing)[number]>(),
      name: new Map<string, (typeof existing)[number]>(),
    };
    for (const c of existing) {
      if (c.ice) index.ice.set(normalizeId(c.ice), c);
      if (c.taxId) index.taxId.set(normalizeId(c.taxId), c);
      if (c.email) index.email.set(c.email.toLowerCase(), c);
      index.name.set(normalizeName(c.displayName), c);
    }

    const dbDuplicates = new Map<number, DbDuplicate>();
    for (const r of rows) {
      const p = r.parsed;
      const candidates: ['ice' | 'taxId' | 'email' | 'name', string | undefined][] = [
        ['ice', r.values.ice ? normalizeId(r.values.ice) : undefined],
        ['taxId', r.values.taxId ? normalizeId(r.values.taxId) : undefined],
        ['email', r.values.email?.toLowerCase()],
        ['name', (p?.displayName ?? r.values.displayName) ? normalizeName(p?.displayName ?? r.values.displayName!) : undefined],
      ];
      for (const [by, key] of candidates) {
        const hit = key ? index[by].get(key) : undefined;
        if (hit) {
          dbDuplicates.set(r.row, {
            by,
            existingId: hit.id,
            label: hit.displayName,
            source: 'database',
            row: null,
          });
          break;
        }
      }
    }

    return {
      response: this.summarize('contacts', csv, mapping, rows, dbDuplicates),
      rows,
      dbDuplicates,
      warehouses: [],
      units: [],
    };
  }

  private async commitContacts(ctx: RequestContext, body: CommitRequest): Promise<CommitResponse> {
    const plan = await this.planContacts(ctx, body);
    const results: RowResult[] = [];
    const work: (() => Promise<void>)[] = [];

    for (const row of plan.rows) {
      const db = plan.dbDuplicates.get(row.row);
      const p = row.parsed;
      if (row.errors.length > 0 || !p) {
        results.push({ row: row.row, status: 'failed', message: row.errors.join('; ') });
        continue;
      }
      if (row.duplicateInFile) {
        results.push({
          row: row.row,
          status: 'skipped',
          message: `Duplicate ${row.duplicateInFile.by} of row ${row.duplicateInFile.row}`,
        });
        continue;
      }
      if (db && body.mode !== 'update') {
        results.push({ row: row.row, status: 'skipped', message: `Already exists (${db.by}: ${db.label})` });
        continue;
      }

      const common = {
        ...(p.code ? { code: p.code } : {}),
        displayName: p.displayName,
        ...(p.legalName ? { legalName: p.legalName } : {}),
        ...(p.ice ? { ice: p.ice } : {}),
        ...(p.rc ? { rc: p.rc } : {}),
        ...(p.taxId ? { taxId: p.taxId } : {}),
        ...(p.patente ? { patente: p.patente } : {}),
        ...(p.email ? { email: p.email } : {}),
        ...(p.phone ? { phone: p.phone } : {}),
        ...(p.phone2 ? { phone2: p.phone2 } : {}),
        ...(p.website ? { website: p.website } : {}),
        ...(p.paymentTerm ? { paymentTerm: p.paymentTerm } : {}),
        ...(p.paymentTermDays !== undefined ? { paymentTermDays: p.paymentTermDays } : {}),
        ...(p.creditLimit ? { creditLimit: p.creditLimit } : {}),
        ...(p.currency ? { defaultCurrency: p.currency } : {}),
        ...(p.vatExempt !== undefined ? { vatExempt: p.vatExempt } : {}),
        ...(p.notes ? { notes: p.notes } : {}),
      };

      if (db) {
        work.push(async () => {
          try {
            await this.contacts.update(ctx, db.existingId!, {
              ...common,
              ...(p.kindGiven ? { kind: p.kind as ContactKind } : {}),
            });
            results.push({ row: row.row, status: 'updated', message: null });
          } catch (error) {
            results.push({ row: row.row, status: 'failed', message: errorMessage(error) });
          }
        });
      } else {
        work.push(async () => {
          try {
            await this.contacts.create(ctx, {
              kind: p.kind,
              paymentTerm: 'IMMEDIATE',
              defaultCurrency: 'MAD',
              vatExempt: false,
              ...common,
              ...(p.address
                ? {
                    addresses: [
                      {
                        kind: 'BILLING' as const,
                        addressLine1: p.address,
                        ...(p.city ? { city: p.city } : {}),
                        ...(p.postalCode ? { postalCode: p.postalCode } : {}),
                        country: countryCode(p.country),
                        isDefault: true,
                      },
                    ],
                  }
                : {}),
            });
            results.push({ row: row.row, status: 'created', message: null });
          } catch (error) {
            results.push({ row: row.row, status: 'failed', message: errorMessage(error) });
          }
        });
      }
    }

    await runInBatches(work);
    return tally(results);
  }
}

// ---------------------------------------------------------------------------

export function countryCode(value: string | undefined): string {
  if (!value) return 'MA';
  const v = normalizeName(value);
  if (['maroc', 'morocco', 'ma', 'المغرب'].includes(v)) return 'MA';
  return value.length <= 3 ? value.toUpperCase() : value;
}

function errorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) {
    // Prisma unique violations are the common case; keep the message short.
    if ('code' in error && (error as { code?: string }).code === 'P2002') {
      return 'A record with the same unique value already exists';
    }
    return error.message.split('\n').slice(-1)[0] ?? 'Unexpected error';
  }
  return 'Unexpected error';
}

async function runInBatches(work: (() => Promise<void>)[]): Promise<void> {
  for (let i = 0; i < work.length; i += BATCH_SIZE) {
    for (const job of work.slice(i, i + BATCH_SIZE)) await job();
  }
}

function tally(results: RowResult[]): CommitResponse {
  results.sort((a, b) => a.row - b.row);
  const count = (status: RowResult['status']) => results.filter((r) => r.status === status).length;
  return {
    created: count('created'),
    updated: count('updated'),
    skipped: count('skipped'),
    failed: count('failed'),
    results,
  };
}
