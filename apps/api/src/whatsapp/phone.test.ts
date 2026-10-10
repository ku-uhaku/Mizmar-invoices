import { describe, expect, it } from 'vitest';
import { normalizePhone, toChatId } from './phone';

describe('normalizePhone', () => {
  it('turns Moroccan local numbers into international digits', () => {
    expect(normalizePhone('06 12 34 56 78')).toBe('212612345678');
    expect(normalizePhone('0712-345-678')).toBe('212712345678');
  });

  it('accepts + and 00 prefixes', () => {
    expect(normalizePhone('+212 6 12 34 56 78')).toBe('212612345678');
    expect(normalizePhone('0033 6 12 34 56 78')).toBe('33612345678');
  });

  it('rejects numbers that cannot be real', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('+1234567890123456')).toBeNull();
  });

  it('builds a chat id', () => {
    expect(toChatId('212612345678')).toBe('212612345678@c.us');
  });
});
