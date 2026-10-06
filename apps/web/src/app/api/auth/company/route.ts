import { NextResponse } from 'next/server';
import { COMPANY_COOKIE } from '@/lib/session';

/**
 * Switch the active legal entity.
 *
 * The id travels as a query parameter rather than a JSON body: the caller
 * reloads the page immediately afterwards, and a request body can still be in
 * flight when that happens.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const companyId = new URL(request.url).searchParams.get('companyId');

  if (!companyId) {
    return NextResponse.json(
      { code: 'BAD_REQUEST', message: 'companyId is required' },
      { status: 400 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COMPANY_COOKIE, companyId, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
