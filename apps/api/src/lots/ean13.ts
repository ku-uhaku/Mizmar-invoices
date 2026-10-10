/** EAN-13 check digit for the first 12 digits. */
export function ean13CheckDigit(body: string): number {
  if (!/^\d{12}$/.test(body)) throw new Error('EAN-13 body must be 12 digits');
  const sum = [...body].reduce((acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** In-store codes live in the 200-299 prefix range reserved for internal use. */
export const INTERNAL_PREFIX = '200';

/** The internal code that follows `lastCode` (or the first one). */
export function nextInternalEan13(lastCode: string | null): string {
  const sequence = lastCode && isValidEan13(lastCode) && lastCode.startsWith(INTERNAL_PREFIX)
    ? Number(lastCode.slice(3, 12)) + 1
    : 1;
  if (sequence > 999_999_999) throw new Error('Internal barcode range exhausted');
  const body = INTERNAL_PREFIX + String(sequence).padStart(9, '0');
  return body + ean13CheckDigit(body);
}
