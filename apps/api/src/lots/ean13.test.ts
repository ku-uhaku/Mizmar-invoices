import { describe, expect, it } from 'vitest';
import { ean13CheckDigit, isValidEan13, nextInternalEan13 } from './ean13';

describe('ean13', () => {
  it('computes known check digits', () => {
    expect(ean13CheckDigit('590123412345')).toBe(7); // 5901234123457
    expect(ean13CheckDigit('400638133393')).toBe(1); // 4006381333931
  });
  it('validates codes', () => {
    expect(isValidEan13('5901234123457')).toBe(true);
    expect(isValidEan13('5901234123458')).toBe(false);
    expect(isValidEan13('123')).toBe(false);
  });
  it('generates internal codes in sequence', () => {
    const first = nextInternalEan13(null);
    expect(first.startsWith('200000000001')).toBe(true);
    expect(isValidEan13(first)).toBe(true);
    const second = nextInternalEan13(first);
    expect(second.startsWith('200000000002')).toBe(true);
    expect(isValidEan13(second)).toBe(true);
  });
  it('restarts when the last code is foreign', () => {
    expect(nextInternalEan13('5901234123457').startsWith('200000000001')).toBe(true);
  });
});
