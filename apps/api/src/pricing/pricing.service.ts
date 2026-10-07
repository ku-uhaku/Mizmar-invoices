import { Injectable } from '@nestjs/common';
import {
  convertAmount,
  isoDay,
  resolveRate,
  selectPrice,
  UNIT_PRICE_SCALE,
  type PriceListLike,
  type RateRow,
  type ResolvedRate,
} from '@mizmar/core';
import { AppError } from '../common/app-error';
import { PrismaService, type PrismaTx } from '../prisma/prisma.service';

export interface ResolveUnitPriceInput {
  companyId: string;
  contactId?: string | null;
  variantId: string;
  quantity: string | number;
  /** Target currency; defaults to the company currency. */
  currency?: string;
  /** ISO date (YYYY-MM-DD); defaults to today. */
  date?: string;
}

export interface ResolvedUnitPrice {
  /** Decimal string at unit-price scale (6). */
  unitPrice: string;
  currency: string;
  source: 'CONTACT_LIST' | 'DEFAULT_LIST' | 'BASE';
  priceListId: string | null;
  discountPercent: string | null;
  conversion: { from: string; rate: string; rateDate: string | null } | null;
}

type Db = PrismaService | PrismaTx;

/**
 * Price and exchange-rate resolution.
 *
 * Unit price precedence (first hit wins), see `selectPrice` in @mizmar/core:
 *   1. the contact's price list (active, valid on the date, with a tier whose
 *      minQuantity <= quantity; the highest such tier wins);
 *   2. the company's default price list, same rules;
 *   3. the variant's base selling price (in the company currency).
 * The chosen price is then converted from the list's currency into the
 * requested currency using the rate valid on the date (most recent earlier
 * rate; the reverse pair is inverted when only that one exists). Missing rate
 * => 422 MISSING_EXCHANGE_RATE rather than silently using 1.
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rate for `from -> to` at `date`, from the company's rate table.
   * Returns null when no rate applies (identity returns 1).
   */
  async findRate(
    companyId: string,
    from: string,
    to: string,
    date: string,
    db: Db = this.prisma,
  ): Promise<ResolvedRate | null> {
    if (from === to) return resolveRate([], from, to, date);
    const rows = await db.exchangeRate.findMany({
      where: {
        companyId,
        validFrom: { lte: new Date(date) },
        OR: [
          { baseCurrency: from, quoteCurrency: to },
          { baseCurrency: to, quoteCurrency: from },
        ],
      },
      orderBy: { validFrom: 'desc' },
      take: 4,
    });
    const table: RateRow[] = rows.map((row) => ({
      base: row.baseCurrency,
      quote: row.quoteCurrency,
      rate: row.rate.toString(),
      validFrom: isoDay(row.validFrom),
    }));
    return resolveRate(table, from, to, date);
  }

  async requireRate(
    companyId: string,
    from: string,
    to: string,
    date: string,
    db: Db = this.prisma,
  ): Promise<ResolvedRate> {
    const found = await this.findRate(companyId, from, to, date, db);
    if (!found) {
      throw AppError.unprocessable(
        'MISSING_EXCHANGE_RATE',
        `No exchange rate from ${from} to ${to} on or before ${date}. Add one under Exchange rates.`,
        { from, to, date },
      );
    }
    return found;
  }

  /**
   * Rate to snapshot on a document: document currency -> company currency
   * (so `totalBase = total * rate`). 1 when the currencies are the same.
   */
  async documentRate(
    companyId: string,
    documentCurrency: string,
    companyCurrency: string,
    date: string,
    db: Db = this.prisma,
  ): Promise<string> {
    const found = await this.requireRate(companyId, documentCurrency, companyCurrency, date, db);
    return found.rate.toDecimalPlaces(8).toFixed(8);
  }

  async resolveUnitPrice(
    input: ResolveUnitPriceInput,
    db: Db = this.prisma,
  ): Promise<ResolvedUnitPrice> {
    const date = input.date ?? isoDay(new Date());

    const company = await db.company.findUnique({
      where: { id: input.companyId },
      select: { organizationId: true, defaultCurrency: true, defaultPriceListId: true },
    });
    if (!company) throw AppError.notFound('Company', input.companyId);
    const targetCurrency = input.currency ?? company.defaultCurrency;

    const variant = await db.productVariant.findFirst({
      where: { id: input.variantId, product: { organizationId: company.organizationId } },
      select: { sellingPrice: true },
    });
    if (!variant) throw AppError.notFound('Product variant', input.variantId);

    let contactListId: string | null = null;
    if (input.contactId) {
      const contact = await db.contact.findFirst({
        where: { id: input.contactId, organizationId: company.organizationId },
        select: { priceListId: true },
      });
      contactListId = contact?.priceListId ?? null;
    }

    const loadList = async (id: string | null): Promise<PriceListLike | null> => {
      if (!id) return null;
      const list = await db.priceList.findFirst({
        where: { id, organizationId: company.organizationId },
        include: { items: { where: { variantId: input.variantId } } },
      });
      if (!list) return null;
      return {
        id: list.id,
        currency: list.currency,
        isActive: list.isActive,
        validFrom: list.validFrom ? isoDay(list.validFrom) : null,
        validTo: list.validTo ? isoDay(list.validTo) : null,
        tiers: list.items.map((item) => ({
          price: item.price.toString(),
          minQuantity: item.minQuantity.toString(),
          discountPercent: item.discountPercent?.toString() ?? null,
        })),
      };
    };

    const selection = selectPrice({
      contactList: await loadList(contactListId),
      defaultList: await loadList(company.defaultPriceListId),
      basePrice: variant.sellingPrice.toString(),
      baseCurrency: company.defaultCurrency,
      quantity: input.quantity,
      date,
    });

    let price = selection.price;
    let conversion: ResolvedUnitPrice['conversion'] = null;
    if (selection.currency !== targetCurrency) {
      const rate = await this.requireRate(
        input.companyId,
        selection.currency,
        targetCurrency,
        date,
        db,
      );
      price = convertAmount(price, rate.rate, { mode: 'HALF_UP', scale: UNIT_PRICE_SCALE });
      conversion = {
        from: selection.currency,
        rate: rate.rate.toDecimalPlaces(8).toFixed(8),
        rateDate: rate.validFrom,
      };
    }

    return {
      unitPrice: price.toFixed(UNIT_PRICE_SCALE),
      currency: targetCurrency,
      source: selection.source,
      priceListId: selection.priceListId,
      discountPercent: selection.discountPercent?.toFixed(3) ?? null,
      conversion,
    };
  }
}
