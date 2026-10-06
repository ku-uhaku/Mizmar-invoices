import { Prisma } from '@prisma/client';
import { dec, type Numeric } from '@mizmar/core';

/** Scale used for quantities everywhere: matches NUMERIC(18,6) in the schema. */
export const QTY_SCALE = 6;
/** Scale used for document money totals: matches NUMERIC(18,2). */
export const MONEY_SCALE = 2;

/** Decimal -> wire string. Money and quantities never cross the wire as numbers. */
export function qtyOut(value: Prisma.Decimal | string | number | null | undefined): string {
  return dec(value as Numeric).toFixed(QTY_SCALE);
}

export function moneyOut(value: Prisma.Decimal | string | number | null | undefined): string {
  return dec(value as Numeric).toFixed(MONEY_SCALE);
}

export function rateOut(value: Prisma.Decimal | string | number | null | undefined): string {
  return dec(value as Numeric).toFixed(2);
}

export function nullableMoneyOut(
  value: Prisma.Decimal | string | number | null | undefined,
): string | null {
  return value === null || value === undefined ? null : moneyOut(value);
}

export function nullableQtyOut(
  value: Prisma.Decimal | string | number | null | undefined,
): string | null {
  return value === null || value === undefined ? null : qtyOut(value);
}

/** Wire string -> Prisma Decimal, for writes. */
export function toPrismaDecimal(value: Numeric | null | undefined): Prisma.Decimal {
  return new Prisma.Decimal(dec(value).toFixed());
}

export function toPrismaDecimalOrNull(
  value: Numeric | null | undefined,
): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  return toPrismaDecimal(value);
}
