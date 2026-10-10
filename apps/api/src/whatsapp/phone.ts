/**
 * Normalise a phone number the way WhatsApp wants it: international format,
 * digits only, no "+" or leading zeros.
 *
 * Moroccan local numbers (06…, 07…, 05…) are by far the common case in this
 * app, so a leading single 0 is read as Morocco unless a default country code
 * says otherwise.
 */
export function normalizePhone(raw: string, defaultCountryCode = '212'): string | null {
  let digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return null;

  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = defaultCountryCode + digits.slice(1);
  }

  digits = digits.replace(/\D/g, '');
  // E.164 allows at most 15 digits; anything under 8 cannot be a real number.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export const toChatId = (phone: string) => `${phone}@c.us`;
