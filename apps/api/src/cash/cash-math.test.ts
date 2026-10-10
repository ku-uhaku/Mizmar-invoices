import { describe, expect, it } from 'vitest';
import { cashDifference, expectedCash } from './cash-math';

describe('expectedCash', () => {
  it('adds float, cash sales and cash in, and subtracts cash out', () => {
    expect(expectedCash({ openingFloat: '200', cashSales: '1234.50', cashIn: '100', cashOut: '50.25' })).toBe('1484.25');
  });
  it('is just the float on a quiet day', () => {
    expect(expectedCash({ openingFloat: '300', cashSales: '0', cashIn: '0', cashOut: '0' })).toBe('300.00');
  });
});

describe('cashDifference', () => {
  it('is negative for a shortage and positive for an overage', () => {
    expect(cashDifference('1480', '1484.25')).toBe('-4.25');
    expect(cashDifference('1490.00', '1484.25')).toBe('5.75');
    expect(cashDifference('10', '10')).toBe('0.00');
  });
});
