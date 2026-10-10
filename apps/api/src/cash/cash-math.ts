import { dec, type Numeric } from '@mizmar/core';

/** Cash that should be in the drawer: float, plus cash sales, plus money put in, minus money taken out. */
export function expectedCash(input: {
  openingFloat: Numeric;
  cashSales: Numeric;
  cashIn: Numeric;
  cashOut: Numeric;
}): string {
  return dec(input.openingFloat)
    .plus(dec(input.cashSales))
    .plus(dec(input.cashIn))
    .minus(dec(input.cashOut))
    .toFixed(2);
}

/** Counted minus expected: negative is a shortage, positive an overage. */
export function cashDifference(counted: Numeric, expected: Numeric): string {
  return dec(counted).minus(dec(expected)).toFixed(2);
}
