import { describe, expect, it } from 'vitest';
import { amountToWords } from './amount-to-words';

describe('amountToWords — English', () => {
  const en = (v: string) => amountToWords(v, 'EN', { capitalize: false });

  it('handles small amounts', () => {
    expect(en('0.00')).toBe('zero dirhams');
    expect(en('1.00')).toBe('one dirham');
    expect(en('2.00')).toBe('two dirhams');
    expect(en('19.00')).toBe('nineteen dirhams');
  });

  it('handles tens and hundreds', () => {
    expect(en('21.00')).toBe('twenty-one dirhams');
    expect(en('100.00')).toBe('one hundred dirhams');
    expect(en('142.00')).toBe('one hundred and forty-two dirhams');
  });

  it('handles scales', () => {
    expect(en('1000.00')).toBe('one thousand dirhams');
    expect(en('1500000.00')).toBe('one million five hundred thousand dirhams');
  });

  it('appends the minor unit', () => {
    expect(en('1788.50')).toBe('one thousand seven hundred and eighty-eight dirhams and fifty centimes');
    expect(en('1.01')).toBe('one dirham and one centime');
  });
});

describe('amountToWords — French', () => {
  const fr = (v: string) => amountToWords(v, 'FR', { capitalize: false });

  it('handles the irregular tens', () => {
    expect(fr('70.00')).toBe('soixante-dix dirhams');
    expect(fr('71.00')).toBe('soixante et onze dirhams');
    expect(fr('80.00')).toBe('quatre-vingts dirhams');
    expect(fr('81.00')).toBe('quatre-vingt-un dirhams');
    expect(fr('91.00')).toBe('quatre-vingt-onze dirhams');
    expect(fr('21.00')).toBe('vingt et un dirhams');
  });

  it('handles cent and cents correctly', () => {
    expect(fr('100.00')).toBe('cent dirhams');
    expect(fr('200.00')).toBe('deux cents dirhams');
    expect(fr('201.00')).toBe('deux cent un dirhams');
  });

  it('never pluralises mille', () => {
    expect(fr('1000.00')).toBe('mille dirhams');
    expect(fr('2000.00')).toBe('deux mille dirhams');
  });

  it('renders a realistic invoice total', () => {
    expect(fr('1788.00')).toBe('mille sept cent quatre-vingt-huit dirhams');
    expect(fr('1788.40')).toBe('mille sept cent quatre-vingt-huit dirhams et quarante centimes');
  });

  it('pluralises millions but not un million', () => {
    expect(fr('1000000.00')).toBe('un million dirhams');
    expect(fr('2000000.00')).toBe('deux millions dirhams');
  });
});

describe('amountToWords — Arabic', () => {
  const ar = (v: string) => amountToWords(v, 'AR', { capitalize: false });

  it('handles units, tens and hundreds', () => {
    expect(ar('0.00')).toBe('صفر دراهم');
    expect(ar('1.00')).toBe('واحد درهم');
    expect(ar('25.00')).toBe('خمسة وعشرون دراهم');
    expect(ar('200.00')).toBe('مائتان دراهم');
  });

  it('uses the dual form for two thousand', () => {
    expect(ar('1000.00')).toBe('ألف دراهم');
    expect(ar('2000.00')).toBe('ألفان دراهم');
  });

  it('appends centimes with the wa conjunction', () => {
    expect(ar('1.50')).toContain('سنتيمات');
  });
});

describe('amountToWords — shared behaviour', () => {
  it('capitalises by default, for the printed line on an invoice', () => {
    expect(amountToWords('1.00', 'FR')).toBe('Un dirham');
  });

  it('handles other currencies', () => {
    expect(amountToWords('5.00', 'EN', { currency: 'EUR', capitalize: false })).toBe('five euros');
  });

  it('handles negatives, which a credit note carries', () => {
    expect(amountToWords('-50.00', 'FR', { capitalize: false })).toBe('moins cinquante dirhams');
  });

  it('can force the minor clause', () => {
    expect(amountToWords('10.00', 'EN', { alwaysShowMinor: true, capitalize: false })).toBe(
      'ten dirhams and zero centimes',
    );
  });

  it('does not lose precision on a large total', () => {
    expect(amountToWords('9876543.21', 'EN', { capitalize: false })).toBe(
      'nine million eight hundred and seventy-six thousand five hundred and forty-three dirhams and twenty-one centimes',
    );
  });
});
