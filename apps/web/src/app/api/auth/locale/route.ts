import { NextResponse } from 'next/server';
import { LOCALE_COOKIE, parseLocale } from '@/lib/i18n/locale';

/** Persist the interface language; the caller refreshes so `<html dir>` follows. */
export async function POST(request: Request): Promise<NextResponse> {
  const locale = parseLocale(new URL(request.url).searchParams.get('locale'));
  const response = NextResponse.json({ ok: true, locale });
  response.cookies.set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
