import { describe, expect, it } from 'vitest';
import { allocate, dec, money, round, sum } from './money';

const CFG = { mode: 'HALF_UP', scale: 2, granularity: 'LINE' } as const;

describe('round', () => {
  it('rounds half away from zero in HALF_UP', () => {
    expect(money('2.005', CFG)).toBe('2.01');
    expect(money('2.004', CFG)).toBe('2.00');
  });

  it('does not suffer binary float error', () => {
    // 0.1 + 0.2 in IEEE-754 is 0.30000000000000004
    expect(dec('0.1').plus(dec('0.2')).toFixed(2)).toBe('0.30');
    expect(money(dec('1.005').times(3), CFG)).toBe('3.02');
  });

  it('supports banker rounding when a company asks for it', () => {
    const even = { mode: 'HALF_EVEN', scale: 2, granularity: 'LINE' } as const;
    expect(round('2.005', even).toFixed(2)).toBe('2.00');
    expect(round('2.015', even).toFixed(2)).toBe('2.02');
  });
});

describe('allocate', () => {
  it('splits exactly, with no lost or invented centimes', () => {
    const parts = allocate('10.00', ['1', '1', '1'], CFG);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['3.34', '3.33', '3.33']);
    expect(sum(parts).toFixed(2)).toBe('10.00');
  });

  it('weights proportionally', () => {
    const parts = allocate('100.00', ['50', '30', '20'], CFG);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['50.00', '30.00', '20.00']);
  });

  it('keeps the sum exact for awkward ratios', () => {
    const parts = allocate('0.07', ['1', '1', '1', '1', '1', '1'], CFG);
    expect(sum(parts).toFixed(2)).toBe('0.07');
  });

  it('handles a zero total', () => {
    expect(allocate('0', ['5', '5'], CFG).map((p) => p.toFixed(2))).toEqual(['0.00', '0.00']);
  });

  it('puts the whole amount on the first line when every weight is zero', () => {
    const parts = allocate('5.00', ['0', '0'], CFG);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['5.00', '0.00']);
    expect(sum(parts).toFixed(2)).toBe('5.00');
  });

  it('preserves sign for negative totals', () => {
    const parts = allocate('-9.99', ['1', '1', '1'], CFG);
    expect(sum(parts).toFixed(2)).toBe('-9.99');
  });

  it('returns nothing for no weights', () => {
    expect(allocate('10', [], CFG)).toEqual([]);
  });
});
