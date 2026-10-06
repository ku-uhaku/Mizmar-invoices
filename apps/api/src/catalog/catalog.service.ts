import { Injectable } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { dec } from '@mizmar/core';
import type { catalogSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { decodeCursor, toPage, type Page } from '../common/util/cursor';
import { qtyOut, rateOut, toPrismaDecimal } from '../common/util/decimal';
import { PrismaService, type PrismaTx } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { StockService, type MovementInput } from '../inventory/stock.service';

type AttributeType = z.infer<typeof catalogSchemas.attributeType>;
type AttributeTypeCreate = z.infer<typeof catalogSchemas.attributeTypeCreate>;
type Product = z.infer<typeof catalogSchemas.product>;
type ProductCreate = z.infer<typeof catalogSchemas.productCreate>;
type ProductUpdate = z.infer<typeof catalogSchemas.productUpdate>;
type ProductListQuery = z.infer<typeof catalogSchemas.productListQuery>;
type VariantInput = z.infer<typeof catalogSchemas.variantInput>;
type VariantMatrixRequest = z.infer<typeof catalogSchemas.variantMatrixRequest>;
type VariantMatrixResponse = z.infer<typeof catalogSchemas.variantMatrixResponse>;
type VariantSearchQuery = z.infer<typeof catalogSchemas.variantSearchQuery>;
type VariantSearchResult = z.infer<typeof catalogSchemas.variantSearchResult>;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  // =========================================================================
  // Attribute types
  // =========================================================================

  async listAttributeTypes(ctx: RequestContext): Promise<AttributeType[]> {
    const rows = await this.prisma.attributeType.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { values: { orderBy: [{ sortOrder: 'asc' }, { value: 'asc' }] } },
    });

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      sortOrder: row.sortOrder,
      values: row.values.map((value) => ({
        id: value.id,
        value: value.value,
        colorHex: value.colorHex,
        sortOrder: value.sortOrder,
      })),
    }));
  }

  async createAttributeType(
    ctx: RequestContext,
    body: AttributeTypeCreate,
  ): Promise<AttributeType> {
    this.assertCanManageCatalog(ctx);
    const row = await this.prisma.attributeType.create({
      data: {
        organizationId: ctx.organizationId,
        code: body.code.toUpperCase(),
        name: body.name,
        sortOrder: body.sortOrder,
        values: {
          create: body.values.map((value, index) => ({
            value: value.value,
            colorHex: value.colorHex ?? null,
            sortOrder: value.sortOrder || index,
          })),
        },
      },
      include: { values: { orderBy: { sortOrder: 'asc' } } },
    });

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      sortOrder: row.sortOrder,
      values: row.values.map((value) => ({
        id: value.id,
        value: value.value,
        colorHex: value.colorHex,
        sortOrder: value.sortOrder,
      })),
    };
  }

  async updateAttributeType(
    ctx: RequestContext,
    id: string,
    body: Partial<AttributeTypeCreate>,
  ): Promise<AttributeType> {
    this.assertCanManageCatalog(ctx);
    const existing = await this.prisma.attributeType.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: { values: true },
    });
    if (!existing) throw AppError.notFound('Attribute type', id);

    await this.prisma.$transaction(async (tx) => {
      await tx.attributeType.update({
        where: { id },
        data: {
          ...(body.code ? { code: body.code.toUpperCase() } : {}),
          ...(body.name ? { name: body.name } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        },
      });

      if (body.values) {
        const existingByValue = new Map(existing.values.map((v) => [v.value, v]));
        for (const [index, value] of body.values.entries()) {
          const match = existingByValue.get(value.value);
          if (match) {
            await tx.attributeValue.update({
              where: { id: match.id },
              data: { colorHex: value.colorHex ?? null, sortOrder: value.sortOrder || index },
            });
          } else {
            await tx.attributeValue.create({
              data: {
                attributeTypeId: id,
                value: value.value,
                colorHex: value.colorHex ?? null,
                sortOrder: value.sortOrder || index,
              },
            });
          }
        }
        // Values already used by a variant are kept: deleting one would rewrite
        // the history of every document that sold it.
      }
    });

    return (await this.listAttributeTypes(ctx)).find((row) => row.id === id)!;
  }

  // =========================================================================
  // Variant matrix preview
  // =========================================================================

  /**
   * Cross-product of the chosen attribute values, with a suggested SKU each.
   *
   * Pure preview: nothing is written, so the user can deselect the combinations
   * that do not exist (there is no XXL in that colour) before saving.
   */
  async variantMatrix(
    ctx: RequestContext,
    body: VariantMatrixRequest,
  ): Promise<VariantMatrixResponse> {
    const valueIds = body.dimensions.flatMap((d) => d.attributeValueIds);
    const values = await this.prisma.attributeValue.findMany({
      where: {
        id: { in: valueIds },
        attributeType: { organizationId: ctx.organizationId },
      },
      include: { attributeType: { select: { id: true, name: true } } },
    });
    const valueById = new Map(values.map((value) => [value.id, value]));

    if (valueById.size !== new Set(valueIds).size) {
      throw AppError.notFound('One or more attribute values');
    }

    const dimensions = body.dimensions.map((dimension) =>
      dimension.attributeValueIds.map((id) => valueById.get(id)!),
    );

    // Iterative cross-product, so adding a fourth dimension costs nothing.
    let combinations: Array<Array<(typeof values)[number]>> = [[]];
    for (const dimension of dimensions) {
      combinations = combinations.flatMap((prefix) =>
        dimension.map((value) => [...prefix, value]),
      );
    }

    const prefix = body.skuPrefix?.trim().toUpperCase() ?? '';

    return {
      combinations: combinations.map((combination) => {
        const label = combination.map((value) => value.value).join(' / ');
        const skuSuffix = combination
          .map((value) => slugForSku(value.value))
          .join('-');

        return {
          suggestedSku: [prefix, skuSuffix].filter(Boolean).join('-'),
          label,
          attributeValueIds: combination.map((value) => value.id),
          attributes: combination.map((value) => ({
            attributeTypeId: value.attributeType.id,
            attributeTypeName: value.attributeType.name,
            attributeValueId: value.id,
            value: value.value,
            colorHex: value.colorHex,
          })),
          costPrice: qtyOut(body.defaults?.costPrice ?? '0'),
          sellingPrice: qtyOut(body.defaults?.sellingPrice ?? '0'),
          minStockThreshold: qtyOut(body.defaults?.minStockThreshold ?? '0'),
        };
      }),
    };
  }

  // =========================================================================
  // Products
  // =========================================================================

  async listProducts(ctx: RequestContext, query: ProductListQuery): Promise<Page<Product>> {
    const cursor = decodeCursor(query.cursor);

    const rows = await this.prisma.product.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.brand ? { brand: query.brand } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { reference: { contains: query.search, mode: 'insensitive' } },
                { variants: { some: { sku: { contains: query.search, mode: 'insensitive' } } } },
                { variants: { some: { barcode: { contains: query.search, mode: 'insensitive' } } } },
              ],
            }
          : {}),
        ...(cursor
          ? { OR: [{ name: { gt: cursor.value } }, { name: cursor.value, id: { gt: cursor.id } }] }
          : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      include: productInclude,
    });

    const mapped = rows
      .map((row) => this.mapProduct(row, ctx))
      .filter((row) => (query.lowStockOnly ? (row.lowStockVariantCount ?? 0) > 0 : true));

    const page = toPage(mapped, query.limit, (row) => ({ value: row.name, id: row.id }));
    return page;
  }

  async getProduct(ctx: RequestContext, id: string): Promise<Product> {
    const row = await this.prisma.product.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: productInclude,
    });
    if (!row) throw AppError.notFound('Product', id);
    return this.mapProduct(row, ctx);
  }

  async createProduct(ctx: RequestContext, body: ProductCreate): Promise<Product> {
    this.assertCanManageCatalog(ctx);

    const id = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          organizationId: ctx.organizationId,
          name: body.name,
          reference: body.reference ?? null,
          description: body.description ?? null,
          category: body.category ?? null,
          brand: body.brand ?? null,
          unitId: body.unitId ?? null,
          defaultVatRate: toPrismaDecimal(body.defaultVatRate),
          isVariantManaged: body.isVariantManaged,
          isService: body.isService,
          attributes: {
            create: body.attributeTypeIds.map((attributeTypeId, index) => ({
              attributeTypeId,
              sortOrder: index,
            })),
          },
        },
      });

      for (const variant of body.variants) {
        await this.createVariant(tx, ctx, product.id, variant);
      }

      return product.id;
    });

    return this.getProduct(ctx, id);
  }

  async updateProduct(ctx: RequestContext, id: string, body: ProductUpdate): Promise<Product> {
    this.assertCanManageCatalog(ctx);
    const existing = await this.prisma.product.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: { variants: { select: { id: true } } },
    });
    if (!existing) throw AppError.notFound('Product', id);

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...(body.name ? { name: body.name } : {}),
          ...(body.reference !== undefined ? { reference: body.reference ?? null } : {}),
          ...(body.description !== undefined ? { description: body.description ?? null } : {}),
          ...(body.category !== undefined ? { category: body.category ?? null } : {}),
          ...(body.brand !== undefined ? { brand: body.brand ?? null } : {}),
          ...(body.unitId !== undefined ? { unitId: body.unitId ?? null } : {}),
          ...(body.defaultVatRate !== undefined
            ? { defaultVatRate: toPrismaDecimal(body.defaultVatRate) }
            : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });

      if (body.attributeTypeIds) {
        await tx.productAttribute.deleteMany({ where: { productId: id } });
        await tx.productAttribute.createMany({
          data: body.attributeTypeIds.map((attributeTypeId, index) => ({
            productId: id,
            attributeTypeId,
            sortOrder: index,
          })),
        });
      }

      if (body.variants) {
        const knownIds = new Set(existing.variants.map((variant) => variant.id));
        for (const variant of body.variants) {
          if (variant.id && knownIds.has(variant.id)) {
            await this.updateVariant(tx, variant.id, variant);
          } else {
            await this.createVariant(tx, ctx, id, variant);
          }
        }
        // Variants are deactivated, never deleted: a variant that has ever been
        // sold is referenced by document lines and stock history.
        const submitted = new Set(body.variants.map((variant) => variant.id).filter(Boolean));
        await tx.productVariant.updateMany({
          where: { productId: id, id: { notIn: [...submitted] as string[] } },
          data: { isActive: false },
        });
      }
    });

    return this.getProduct(ctx, id);
  }

  async removeProduct(ctx: RequestContext, id: string): Promise<void> {
    this.assertCanManageCatalog(ctx);
    const existing = await this.prisma.product.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: {
        id: true,
        _count: { select: { variants: true } },
        variants: { select: { _count: { select: { documentLines: true, movements: true } } } },
      },
    });
    if (!existing) throw AppError.notFound('Product', id);

    const referenced = existing.variants.some(
      (variant) => variant._count.documentLines > 0 || variant._count.movements > 0,
    );

    if (referenced) {
      // Soft delete: hard-deleting would orphan documents and the stock ledger.
      await this.prisma.$transaction([
        this.prisma.product.update({ where: { id }, data: { isActive: false } }),
        this.prisma.productVariant.updateMany({
          where: { productId: id },
          data: { isActive: false },
        }),
      ]);
      return;
    }

    await this.prisma.product.delete({ where: { id } });
  }

  // =========================================================================
  // Variant search — the document editor's line picker
  // =========================================================================

  async searchVariants(
    ctx: RequestContext,
    query: VariantSearchQuery,
  ): Promise<VariantSearchResult[]> {
    const term = query.q.trim();
    const maySeeCost = ctx.ability.can('read', 'ProductVariant', 'costPrice');
    const maySeePrice = ctx.ability.can('read', 'ProductVariant', 'sellingPrice');

    const warehouseId =
      query.warehouseId ??
      (
        await this.prisma.company.findUnique({
          where: { id: ctx.companyId },
          select: { defaultWarehouseId: true },
        })
      )?.defaultWarehouseId ??
      undefined;

    const variants = await this.prisma.productVariant.findMany({
      where: {
        product: { organizationId: ctx.organizationId, isActive: true },
        ...(query.includeInactive ? {} : { isActive: true }),
        OR: [
          // An exact barcode match is what a scanner produces, so it is first.
          { barcode: term },
          { sku: { contains: term, mode: 'insensitive' } },
          { variantLabel: { contains: term, mode: 'insensitive' } },
          { product: { name: { contains: term, mode: 'insensitive' } } },
          { product: { reference: { contains: term, mode: 'insensitive' } } },
          {
            attributeValues: {
              some: { attributeValue: { value: { contains: term, mode: 'insensitive' } } },
            },
          },
        ],
      },
      take: query.limit,
      orderBy: [{ sku: 'asc' }],
      include: {
        product: {
          select: {
            id: true,
            name: true,
            isService: true,
            defaultVatRate: true,
            unit: { select: { code: true } },
          },
        },
        stockLevels: warehouseId
          ? { where: { warehouseId }, select: { onHand: true, reserved: true } }
          : { select: { onHand: true, reserved: true } },
      },
    });

    return variants.map((variant) => {
      const onHand = variant.stockLevels.reduce(
        (acc, level) => acc.plus(dec(level.onHand.toFixed())),
        dec(0),
      );
      const reserved = variant.stockLevels.reduce(
        (acc, level) => acc.plus(dec(level.reserved.toFixed())),
        dec(0),
      );
      const available = onHand.minus(reserved);
      const threshold = dec(variant.minStockThreshold.toFixed());

      return {
        variantId: variant.id,
        productId: variant.product.id,
        productName: variant.product.name,
        sku: variant.sku,
        barcode: variant.barcode,
        variantLabel: variant.variantLabel,
        unitCode: variant.product.unit?.code ?? null,
        ...(maySeePrice ? { sellingPrice: qtyOut(variant.sellingPrice) } : {}),
        ...(maySeeCost ? { costPrice: qtyOut(variant.costPrice) } : {}),
        vatRate: rateOut(variant.product.defaultVatRate),
        imageUrl: null,
        isService: variant.product.isService,
        onHand: qtyOut(onHand),
        reserved: qtyOut(reserved),
        available: qtyOut(available),
        minStockThreshold: qtyOut(threshold),
        isLowStock: !variant.product.isService && available.lte(threshold),
      };
    });
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private assertCanManageCatalog(ctx: RequestContext): void {
    if (!ctx.ability.can('manage', 'Product') && !ctx.ability.can('create', 'Product')) {
      throw AppError.forbidden('Your role may not change the catalog');
    }
  }

  private async createVariant(
    tx: PrismaTx,
    ctx: RequestContext,
    productId: string,
    input: VariantInput,
  ): Promise<string> {
    const label = await this.buildVariantLabel(tx, input.attributeValueIds);

    const variant = await tx.productVariant.create({
      data: {
        productId,
        sku: input.sku.trim(),
        barcode: input.barcode?.trim() || null,
        variantLabel: label,
        costPrice: toPrismaDecimal(input.costPrice),
        sellingPrice: toPrismaDecimal(input.sellingPrice),
        minStockThreshold: toPrismaDecimal(input.minStockThreshold),
        weightGrams: input.weightGrams ?? null,
        isActive: input.isActive,
        attributeValues: {
          create: input.attributeValueIds.map((attributeValueId) => ({ attributeValueId })),
        },
      },
    });

    // Opening stock goes through the ledger like everything else, so day-one
    // quantities are auditable rather than appearing from nowhere.
    const opening = (input.openingStock ?? []).filter((entry) => !dec(entry.quantity).isZero());
    if (opening.length > 0) {
      const inputs: MovementInput[] = opening.map((entry) => ({
        variantId: variant.id,
        warehouseId: entry.warehouseId,
        signedQuantity: dec(entry.quantity).toFixed(),
        type: MovementType.OPENING_BALANCE,
        unitCost: input.costPrice,
        note: 'Opening balance',
      }));
      await this.stock.applyMovements(tx, inputs, ctx.userId);
    }

    return variant.id;
  }

  private async updateVariant(
    tx: PrismaTx,
    id: string,
    input: VariantInput,
  ): Promise<void> {
    const label = input.attributeValueIds.length
      ? await this.buildVariantLabel(tx, input.attributeValueIds)
      : undefined;

    await tx.productVariant.update({
      where: { id },
      data: {
        sku: input.sku.trim(),
        barcode: input.barcode?.trim() || null,
        ...(label !== undefined ? { variantLabel: label } : {}),
        costPrice: toPrismaDecimal(input.costPrice),
        sellingPrice: toPrismaDecimal(input.sellingPrice),
        minStockThreshold: toPrismaDecimal(input.minStockThreshold),
        weightGrams: input.weightGrams ?? null,
        isActive: input.isActive,
      },
    });

    if (input.attributeValueIds.length > 0) {
      await tx.variantAttributeValue.deleteMany({ where: { variantId: id } });
      await tx.variantAttributeValue.createMany({
        data: input.attributeValueIds.map((attributeValueId) => ({
          variantId: id,
          attributeValueId,
        })),
      });
    }
  }

  /** "Red / L", cached on the variant so lists and PDFs need no join. */
  private async buildVariantLabel(
    tx: PrismaTx,
    attributeValueIds: string[],
  ): Promise<string | null> {
    if (attributeValueIds.length === 0) return null;
    const values = await tx.attributeValue.findMany({
      where: { id: { in: attributeValueIds } },
      include: { attributeType: { select: { sortOrder: true, name: true } } },
    });
    return (
      values
        .sort((a, b) => a.attributeType.sortOrder - b.attributeType.sortOrder)
        .map((value) => value.value)
        .join(' / ') || null
    );
  }

  private mapProduct(
    row: Prisma.ProductGetPayload<{ include: typeof productInclude }>,
    ctx: RequestContext,
  ): Product {
    const maySeeCost = ctx.ability.can('read', 'ProductVariant', 'costPrice');
    const maySeePrice = ctx.ability.can('read', 'ProductVariant', 'sellingPrice');

    let totalOnHand = dec(0);
    let lowStockVariantCount = 0;

    const variants = row.variants.map((variant) => {
      const onHand = variant.stockLevels.reduce(
        (acc, level) => acc.plus(dec(level.onHand.toFixed())),
        dec(0),
      );
      const reserved = variant.stockLevels.reduce(
        (acc, level) => acc.plus(dec(level.reserved.toFixed())),
        dec(0),
      );
      const threshold = dec(variant.minStockThreshold.toFixed());
      totalOnHand = totalOnHand.plus(onHand);
      if (!row.isService && onHand.minus(reserved).lte(threshold)) lowStockVariantCount += 1;

      // Weighted rollup across warehouses, for display only; the authoritative
      // valuation is per warehouse on the level row.
      const valuation = variant.stockLevels.reduce(
        (acc, level) =>
          acc.plus(dec(level.onHand.toFixed()).times(dec(level.averageCost.toFixed()))),
        dec(0),
      );

      return {
        id: variant.id,
        productId: row.id,
        sku: variant.sku,
        barcode: variant.barcode,
        variantLabel: variant.variantLabel,
        ...(maySeeCost
          ? {
              costPrice: qtyOut(variant.costPrice),
              averageCost: qtyOut(onHand.gt(0) ? valuation.div(onHand) : 0),
            }
          : {}),
        ...(maySeePrice ? { sellingPrice: qtyOut(variant.sellingPrice) } : {}),
        minStockThreshold: qtyOut(threshold),
        weightGrams: variant.weightGrams,
        imageUrl: null,
        isActive: variant.isActive,
        attributes: variant.attributeValues.map((link) => ({
          attributeTypeId: link.attributeValue.attributeType.id,
          attributeTypeName: link.attributeValue.attributeType.name,
          attributeValueId: link.attributeValue.id,
          value: link.attributeValue.value,
          colorHex: link.attributeValue.colorHex,
        })),
      };
    });

    return {
      id: row.id,
      name: row.name,
      reference: row.reference,
      description: row.description,
      category: row.category,
      brand: row.brand,
      unitId: row.unitId,
      unitCode: row.unit?.code ?? null,
      defaultVatRate: rateOut(row.defaultVatRate),
      isVariantManaged: row.isVariantManaged,
      isService: row.isService,
      isActive: row.isActive,
      attributeTypeIds: row.attributes
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((attribute) => attribute.attributeTypeId),
      variants,
      imageUrls: [],
      totalOnHand: qtyOut(totalOnHand),
      lowStockVariantCount,
    };
  }
}

const productInclude = {
  unit: { select: { code: true } },
  attributes: { select: { attributeTypeId: true, sortOrder: true } },
  variants: {
    orderBy: { sku: 'asc' },
    include: {
      stockLevels: { select: { onHand: true, reserved: true, averageCost: true } },
      attributeValues: {
        include: {
          attributeValue: {
            include: { attributeType: { select: { id: true, name: true, sortOrder: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.ProductInclude;

/** Compact, URL- and label-safe token for a generated SKU. */
function slugForSku(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 6);
}
