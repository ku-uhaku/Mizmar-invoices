/**
 * A fresh EAN-13 for items that carry no manufacturer barcode. The 20–29
 * prefix range is reserved by GS1 for in-store use, so it cannot collide with
 * a code printed on someone else's product.
 */
export function generateEan13(): string {
  const digits = [2, Math.floor(Math.random() * 10)];
  while (digits.length < 12) digits.push(Math.floor(Math.random() * 10));
  const sum = digits.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return [...digits, (10 - (sum % 10)) % 10].join('');
}
