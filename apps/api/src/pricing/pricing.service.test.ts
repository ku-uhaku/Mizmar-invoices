import { describe, expect, it } from 'vitest';
import { PricingService } from './pricing.service';
import type { PrismaService } from '../prisma/prisma.service';

interface ListRow {
  id: string;
  currency: string;
  isActive: boolean;
  validFrom: Date | null;
  validTo: Date | null;
  items: Array<{ variantId: string; price: string; minQuantity: string; discountPercent: string | null }>;
}
interface RateRow {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  validFrom: Date;
}

/** Minimal in-memory stand-in for the handful of Prisma calls the service makes. */
function fakePrisma(opts: {
  company?: { defaultPriceListId: string | null };
  contactListId?: string | null;
  lists?: ListRow[];
  rates?: RateRow[];
  basePrice?: string;
}) {
  const lists = opts.lists ?? [];
  const rates = opts.rates ?? [];
  return {
    company: {
      findUnique: async () => ({
        organizationId: 'org',
        defaultCurrency: 'MAD',
        defaultPriceListId: opts.company?.defaultPriceListId ?? null,
      }),
    },
    productVariant: { findFirst: async () => ({ sellingPrice: opts.basePrice ?? '100' }) },
    contact: { findFirst: async () => ({ priceListId: opts.contactListId ?? null }) },
    priceList: {
      findFirst: async ({ where, include }: { where: { id: string }; include: { items: { where: { variantId: string } } } }) => {
        const list = lists.find((l) => l.id === where.id);
        if (!list) return null;
        return {
          ...list,
          items: list.items
            .filter((i) => i.variantId === include.items.where.variantId)
            .map((i) => ({ ...i, price: { toString: () => i.price }, minQuantity: { toString: () => i.minQuantity }, discountPercent: i.discountPercent ? { toString: () => i.discountPercent! } : null })),
        };
      },
    },
    exchangeRate: {
      findMany: async ({ where }: { where: { validFrom: { lte: Date }; OR: Array<{ baseCurrency: string; quoteCurrency: string }> } }) =>
        rates
          .filter(
            (r) =>
              r.validFrom <= where.validFrom.lte &&
              where.OR.some((p) => p.baseCurrency === r.baseCurrency && p.quoteCurrency === r.quoteCurrency),
          )
          .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())
          .map((r) => ({ ...r, rate: { toString: () => r.rate } })),
    },
  } as unknown as PrismaService;
}

const list = (id: string, price: string, extra: Partial<ListRow> = {}): ListRow => ({
  id,
  currency: 'MAD',
  isActive: true,
  validFrom: null,
  validTo: null,
  items: [{ variantId: 'v', price, minQuantity: '0', discountPercent: null }],
  ...extra,
});

const base = { companyId: 'c', contactId: 'k', variantId: 'v', quantity: 1, date: '2026-05-01' };

describe('PricingService.resolveUnitPrice', () => {
  it('uses the variant base price when no list applies', async () => {
    const svc = new PricingService(fakePrisma({}));
    const r = await svc.resolveUnitPrice(base);
    expect(r).toMatchObject({ unitPrice: '100.000000', source: 'BASE', currency: 'MAD', conversion: null });
  });

  it('prefers the contact list over the company default list', async () => {
    const svc = new PricingService(
      fakePrisma({
        contactListId: 'cl',
        company: { defaultPriceListId: 'dl' },
        lists: [list('cl', '70'), list('dl', '80')],
      }),
    );
    expect(await svc.resolveUnitPrice(base)).toMatchObject({ unitPrice: '70.000000', source: 'CONTACT_LIST', priceListId: 'cl' });
  });

  it('falls through an expired contact list to the default list', async () => {
    const svc = new PricingService(
      fakePrisma({
        contactListId: 'cl',
        company: { defaultPriceListId: 'dl' },
        lists: [list('cl', '70', { validTo: new Date('2026-04-30') }), list('dl', '80')],
      }),
    );
    expect(await svc.resolveUnitPrice(base)).toMatchObject({ unitPrice: '80.000000', source: 'DEFAULT_LIST' });
  });

  it('applies quantity tiers', async () => {
    const tiered = list('cl', '70', {
      items: [
        { variantId: 'v', price: '70', minQuantity: '0', discountPercent: null },
        { variantId: 'v', price: '60', minQuantity: '10', discountPercent: '5' },
      ],
    });
    const svc = new PricingService(fakePrisma({ contactListId: 'cl', lists: [tiered] }));
    expect((await svc.resolveUnitPrice({ ...base, quantity: 9 })).unitPrice).toBe('70.000000');
    expect(await svc.resolveUnitPrice({ ...base, quantity: 10 })).toMatchObject({
      unitPrice: '60.000000',
      discountPercent: '5.000',
    });
  });

  it('converts a list price into the requested currency', async () => {
    const svc = new PricingService(
      fakePrisma({
        contactListId: 'cl',
        lists: [list('cl', '10', { currency: 'EUR' })],
        rates: [
          { baseCurrency: 'EUR', quoteCurrency: 'MAD', rate: '10.5', validFrom: new Date('2026-01-01') },
          { baseCurrency: 'EUR', quoteCurrency: 'MAD', rate: '11', validFrom: new Date('2026-09-01') },
        ],
      }),
    );
    const r = await svc.resolveUnitPrice({ ...base, currency: 'MAD' });
    expect(r.unitPrice).toBe('105.000000');
    expect(r.conversion).toEqual({ from: 'EUR', rate: '10.50000000', rateDate: '2026-01-01' });
  });

  it('converts the base price using the inverse of the reverse pair', async () => {
    const svc = new PricingService(
      fakePrisma({
        rates: [{ baseCurrency: 'EUR', quoteCurrency: 'MAD', rate: '10', validFrom: new Date('2026-01-01') }],
      }),
    );
    const r = await svc.resolveUnitPrice({ ...base, currency: 'EUR' });
    expect(r.unitPrice).toBe('10.000000');
    expect(r.currency).toBe('EUR');
  });

  it('fails loudly when no rate exists', async () => {
    const svc = new PricingService(fakePrisma({}));
    await expect(svc.resolveUnitPrice({ ...base, currency: 'USD' })).rejects.toMatchObject({
      code: 'MISSING_EXCHANGE_RATE',
    });
  });

  it('documentRate is 1 for the company currency and snapshots otherwise', async () => {
    const svc = new PricingService(
      fakePrisma({
        rates: [{ baseCurrency: 'EUR', quoteCurrency: 'MAD', rate: '10.8', validFrom: new Date('2026-01-01') }],
      }),
    );
    expect(await svc.documentRate('c', 'MAD', 'MAD', '2026-05-01')).toBe('1.00000000');
    expect(await svc.documentRate('c', 'EUR', 'MAD', '2026-05-01')).toBe('10.80000000');
  });
});
