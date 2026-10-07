import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, isoDay } from '@mizmar/core';
import type { pricingSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { toPrismaDecimal, toPrismaDecimalOrNull } from '../common/util/decimal';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { PricingService } from './pricing.service';

type PriceList = z.infer<typeof pricingSchemas.priceList>;
type PriceListDetail = z.infer<typeof pricingSchemas.priceListDetail>;
type PriceListItem = z.infer<typeof pricingSchemas.priceListItem>;
type PriceListCreate = z.infer<typeof pricingSchemas.priceListCreate>;
type PriceListUpdate = z.infer<typeof pricingSchemas.priceListUpdate>;
type ItemUpsert = z.infer<typeof pricingSchemas.priceListItemUpsert>;
type ItemUpdate = z.infer<typeof pricingSchemas.priceListItemUpdate>;
type ExchangeRate = z.infer<typeof pricingSchemas.exchangeRate>;
type RateCreate = z.infer<typeof pricingSchemas.exchangeRateCreate>;
type RateUpdate = z.infer<typeof pricingSchemas.exchangeRateUpdate>;
type RateListQuery = z.infer<typeof pricingSchemas.exchangeRateListQuery>;
type RateLookupQuery = z.infer<typeof pricingSchemas.exchangeRateLookupQuery>;
type RateLookup = z.infer<typeof pricingSchemas.exchangeRateLookup>;
type ResolveQuery = z.infer<typeof pricingSchemas.resolveQuery>;
type ResolvedPrice = z.infer<typeof pricingSchemas.resolvedPrice>;

const itemInclude = {
  variant: {
    select: {
      sku: true,
      variantLabel: true,
      product: { select: { name: true } },
    },
  },
} satisfies Prisma.PriceListItemInclude;

type ItemRow = Prisma.PriceListItemGetPayload<{ include: typeof itemInclude }>;

/** CRUD for price lists, their items and exchange rates, plus the resolve endpoint. */
@Injectable()
export class PriceListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  // -------------------------------------------------------------------------
  // Permissions
  // -------------------------------------------------------------------------

  private assertCanManageLists(ctx: RequestContext): void {
    if (!ctx.ability.can('update', 'Product')) throw AppError.forbidden();
  }

  /** Accountants keep the rates, though they cannot configure company settings. */
  private assertCanManageRates(ctx: RequestContext): void {
    if (!ctx.ability.can('configure', 'Settings') && !ctx.ability.can('create', 'Payment')) {
      throw AppError.forbidden();
    }
  }

  // -------------------------------------------------------------------------
  // Price lists
  // -------------------------------------------------------------------------

  async list(ctx: RequestContext): Promise<PriceList[]> {
    const [rows, company] = await Promise.all([
      this.prisma.priceList.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: { name: 'asc' },
        include: { _count: { select: { items: true, contacts: true } } },
      }),
      this.defaultListId(ctx),
    ]);
    return rows.map((row) => ({
      ...this.mapList(row, company),
      itemCount: row._count.items,
      contactCount: row._count.contacts,
    }));
  }

  async get(ctx: RequestContext, id: string): Promise<PriceListDetail> {
    const row = await this.prisma.priceList.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: {
        items: { include: itemInclude, orderBy: [{ variant: { sku: 'asc' } }, { minQuantity: 'asc' }] },
        contacts: { select: { id: true, displayName: true }, orderBy: { displayName: 'asc' } },
      },
    });
    if (!row) throw AppError.notFound('Price list', id);
    return {
      ...this.mapList(row, await this.defaultListId(ctx)),
      itemCount: row.items.length,
      contactCount: row.contacts.length,
      items: row.items.map((item) => this.mapItem(item)),
      contacts: row.contacts,
    };
  }

  async create(ctx: RequestContext, body: PriceListCreate): Promise<PriceListDetail> {
    this.assertCanManageLists(ctx);
    this.assertWindow(body.validFrom, body.validTo);
    try {
      const row = await this.prisma.priceList.create({
        data: {
          organizationId: ctx.organizationId,
          name: body.name,
          currency: body.currency,
          isActive: body.isActive,
          validFrom: body.validFrom ? new Date(body.validFrom) : null,
          validTo: body.validTo ? new Date(body.validTo) : null,
        },
      });
      return this.get(ctx, row.id);
    } catch (error) {
      throw this.duplicateName(error, body.name);
    }
  }

  async update(ctx: RequestContext, id: string, body: PriceListUpdate): Promise<PriceListDetail> {
    this.assertCanManageLists(ctx);
    const existing = await this.requireList(ctx, id);
    this.assertWindow(
      body.validFrom === undefined ? existing.validFrom && isoDay(existing.validFrom) : body.validFrom,
      body.validTo === undefined ? existing.validTo && isoDay(existing.validTo) : body.validTo,
    );
    try {
      await this.prisma.priceList.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.currency !== undefined ? { currency: body.currency } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(body.validFrom !== undefined
            ? { validFrom: body.validFrom ? new Date(body.validFrom) : null }
            : {}),
          ...(body.validTo !== undefined
            ? { validTo: body.validTo ? new Date(body.validTo) : null }
            : {}),
        },
      });
    } catch (error) {
      throw this.duplicateName(error, body.name ?? existing.name);
    }
    return this.get(ctx, id);
  }

  /** Contacts and the company default fall back via ON DELETE SET NULL. */
  async remove(ctx: RequestContext, id: string): Promise<void> {
    this.assertCanManageLists(ctx);
    await this.requireList(ctx, id);
    await this.prisma.priceList.delete({ where: { id } });
  }

  async upsertItem(ctx: RequestContext, listId: string, body: ItemUpsert): Promise<PriceListItem> {
    this.assertCanManageLists(ctx);
    await this.requireList(ctx, listId);
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: body.variantId, product: { organizationId: ctx.organizationId } },
      select: { id: true },
    });
    if (!variant) throw AppError.notFound('Product variant', body.variantId);

    const price = this.checkedPrice(body.price);
    const minQuantity = this.checkedMinQuantity(body.minQuantity);
    const discount = this.checkedDiscount(body.discountPercent);

    const row = await this.prisma.priceListItem.upsert({
      where: {
        priceListId_variantId_minQuantity: {
          priceListId: listId,
          variantId: body.variantId,
          minQuantity,
        },
      },
      create: { priceListId: listId, variantId: body.variantId, price, minQuantity, discountPercent: discount },
      update: { price, discountPercent: discount },
      include: itemInclude,
    });
    return this.mapItem(row);
  }

  async updateItem(ctx: RequestContext, itemId: string, body: ItemUpdate): Promise<PriceListItem> {
    this.assertCanManageLists(ctx);
    const existing = await this.prisma.priceListItem.findFirst({
      where: { id: itemId, priceList: { organizationId: ctx.organizationId } },
    });
    if (!existing) throw AppError.notFound('Price list item', itemId);
    try {
      const row = await this.prisma.priceListItem.update({
        where: { id: itemId },
        data: {
          ...(body.price !== undefined ? { price: this.checkedPrice(body.price) } : {}),
          ...(body.minQuantity !== undefined
            ? { minQuantity: this.checkedMinQuantity(body.minQuantity) }
            : {}),
          ...(body.discountPercent !== undefined
            ? { discountPercent: this.checkedDiscount(body.discountPercent) }
            : {}),
        },
        include: itemInclude,
      });
      return this.mapItem(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppError.conflict('DUPLICATE_TIER', 'This variant already has a tier at that quantity');
      }
      throw error;
    }
  }

  async removeItem(ctx: RequestContext, itemId: string): Promise<void> {
    this.assertCanManageLists(ctx);
    const existing = await this.prisma.priceListItem.findFirst({
      where: { id: itemId, priceList: { organizationId: ctx.organizationId } },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound('Price list item', itemId);
    await this.prisma.priceListItem.delete({ where: { id: itemId } });
  }

  async assignContacts(
    ctx: RequestContext,
    listId: string,
    body: { contactIds: string[]; replace: boolean },
  ): Promise<PriceListDetail> {
    this.assertCanManageLists(ctx);
    await this.requireList(ctx, listId);
    await this.prisma.$transaction(async (tx) => {
      if (body.replace) {
        await tx.contact.updateMany({
          where: {
            organizationId: ctx.organizationId,
            priceListId: listId,
            id: { notIn: body.contactIds },
          },
          data: { priceListId: null },
        });
      }
      if (body.contactIds.length > 0) {
        await tx.contact.updateMany({
          where: { organizationId: ctx.organizationId, id: { in: body.contactIds } },
          data: { priceListId: listId },
        });
      }
    });
    return this.get(ctx, listId);
  }

  async getDefault(ctx: RequestContext): Promise<{ priceListId: string | null }> {
    return { priceListId: await this.defaultListId(ctx) };
  }

  async setDefault(
    ctx: RequestContext,
    priceListId: string | null,
  ): Promise<{ priceListId: string | null }> {
    this.assertCanManageLists(ctx);
    if (priceListId) await this.requireList(ctx, priceListId);
    await this.prisma.company.update({
      where: { id: ctx.companyId },
      data: { defaultPriceListId: priceListId },
    });
    return { priceListId };
  }

  // -------------------------------------------------------------------------
  // Exchange rates
  // -------------------------------------------------------------------------

  async listRates(ctx: RequestContext, query: RateListQuery): Promise<ExchangeRate[]> {
    const rows = await this.prisma.exchangeRate.findMany({
      where: {
        companyId: ctx.companyId,
        ...(query.baseCurrency ? { baseCurrency: query.baseCurrency } : {}),
        ...(query.quoteCurrency ? { quoteCurrency: query.quoteCurrency } : {}),
      },
      orderBy: [{ baseCurrency: 'asc' }, { quoteCurrency: 'asc' }, { validFrom: 'desc' }],
    });
    return rows.map((row) => this.mapRate(row));
  }

  async createRate(ctx: RequestContext, body: RateCreate): Promise<ExchangeRate> {
    this.assertCanManageRates(ctx);
    if (body.baseCurrency === body.quoteCurrency) {
      throw AppError.badRequest('SAME_CURRENCY', 'Base and quote currencies must differ');
    }
    try {
      const row = await this.prisma.exchangeRate.create({
        data: {
          companyId: ctx.companyId,
          baseCurrency: body.baseCurrency,
          quoteCurrency: body.quoteCurrency,
          rate: this.checkedRate(body.rate),
          validFrom: new Date(body.validFrom),
        },
      });
      return this.mapRate(row);
    } catch (error) {
      throw this.duplicateRate(error);
    }
  }

  async updateRate(ctx: RequestContext, id: string, body: RateUpdate): Promise<ExchangeRate> {
    this.assertCanManageRates(ctx);
    await this.requireRate(ctx, id);
    try {
      const row = await this.prisma.exchangeRate.update({
        where: { id },
        data: {
          ...(body.rate !== undefined ? { rate: this.checkedRate(body.rate) } : {}),
          ...(body.validFrom ? { validFrom: new Date(body.validFrom) } : {}),
        },
      });
      return this.mapRate(row);
    } catch (error) {
      throw this.duplicateRate(error);
    }
  }

  /** Documents snapshot their own rate, so deleting a table row never changes them. */
  async removeRate(ctx: RequestContext, id: string): Promise<void> {
    this.assertCanManageRates(ctx);
    await this.requireRate(ctx, id);
    await this.prisma.exchangeRate.delete({ where: { id } });
  }

  async lookupRate(ctx: RequestContext, query: RateLookupQuery): Promise<RateLookup> {
    const date = query.date ?? isoDay(new Date());
    const found = await this.pricing.requireRate(ctx.companyId, query.base, query.quote, date);
    return {
      base: query.base,
      quote: query.quote,
      rate: found.rate.toDecimalPlaces(8).toFixed(8),
      validFrom: found.validFrom,
      inverted: found.inverted,
    };
  }

  // -------------------------------------------------------------------------
  // Resolve
  // -------------------------------------------------------------------------

  async resolve(ctx: RequestContext, query: ResolveQuery): Promise<ResolvedPrice> {
    return this.pricing.resolveUnitPrice({
      companyId: ctx.companyId,
      contactId: query.contactId,
      variantId: query.variantId,
      quantity: query.quantity,
      currency: query.currency,
      date: query.date,
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async defaultListId(ctx: RequestContext): Promise<string | null> {
    const company = await this.prisma.company.findUnique({
      where: { id: ctx.companyId },
      select: { defaultPriceListId: true },
    });
    return company?.defaultPriceListId ?? null;
  }

  private async requireList(ctx: RequestContext, id: string) {
    const row = await this.prisma.priceList.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!row) throw AppError.notFound('Price list', id);
    return row;
  }

  private async requireRate(ctx: RequestContext, id: string) {
    const row = await this.prisma.exchangeRate.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!row) throw AppError.notFound('Exchange rate', id);
    return row;
  }

  private assertWindow(from: string | null | undefined, to: string | null | undefined): void {
    if (from && to && from > to) {
      throw AppError.badRequest('INVALID_VALIDITY', 'validFrom must not be after validTo');
    }
  }

  private checkedPrice(value: string | number): Prisma.Decimal {
    const d = dec(value);
    if (d.isNegative()) throw AppError.badRequest('INVALID_PRICE', 'Price must not be negative');
    return toPrismaDecimal(d);
  }

  private checkedMinQuantity(value: string | number): Prisma.Decimal {
    const d = dec(value);
    if (d.isNegative()) throw AppError.badRequest('INVALID_QUANTITY', 'Minimum quantity must not be negative');
    return toPrismaDecimal(d);
  }

  private checkedDiscount(value: string | number | null | undefined): Prisma.Decimal | null {
    if (value === null || value === undefined) return null;
    const d = dec(value);
    if (d.isNegative() || d.gt(100)) {
      throw AppError.badRequest('INVALID_DISCOUNT', 'Discount must be between 0 and 100');
    }
    return toPrismaDecimalOrNull(d);
  }

  private checkedRate(value: string | number): Prisma.Decimal {
    const d = dec(value);
    if (d.lte(0)) throw AppError.badRequest('INVALID_RATE', 'Rate must be greater than zero');
    return toPrismaDecimal(d);
  }

  private duplicateName(error: unknown, name: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return AppError.conflict('DUPLICATE_NAME', `A price list named "${name}" already exists`);
    }
    return error;
  }

  private duplicateRate(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return AppError.conflict('DUPLICATE_RATE', 'A rate for this pair already exists on that date');
    }
    return error;
  }

  private mapList(
    row: {
      id: string;
      name: string;
      currency: string;
      isActive: boolean;
      validFrom: Date | null;
      validTo: Date | null;
    },
    defaultId: string | null,
  ) {
    return {
      id: row.id,
      name: row.name,
      currency: row.currency,
      isActive: row.isActive,
      validFrom: row.validFrom ? isoDay(row.validFrom) : null,
      validTo: row.validTo ? isoDay(row.validTo) : null,
      isDefault: row.id === defaultId,
    };
  }

  private mapItem(row: ItemRow): PriceListItem {
    return {
      id: row.id,
      priceListId: row.priceListId,
      variantId: row.variantId,
      sku: row.variant.sku,
      productName: row.variant.product.name,
      variantLabel: row.variant.variantLabel,
      price: dec(row.price.toString()).toFixed(6),
      minQuantity: dec(row.minQuantity.toString()).toFixed(6),
      discountPercent: row.discountPercent ? dec(row.discountPercent.toString()).toFixed(3) : null,
    };
  }

  private mapRate(row: {
    id: string;
    baseCurrency: string;
    quoteCurrency: string;
    rate: Prisma.Decimal;
    validFrom: Date;
  }): ExchangeRate {
    return {
      id: row.id,
      baseCurrency: row.baseCurrency,
      quoteCurrency: row.quoteCurrency,
      rate: dec(row.rate.toString()).toFixed(8),
      validFrom: isoDay(row.validFrom),
    };
  }
}
