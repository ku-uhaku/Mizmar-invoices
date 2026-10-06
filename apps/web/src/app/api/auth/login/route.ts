import { NextResponse } from 'next/server';
import { apiBaseUrl, COMPANY_COOKIE, sessionCookies } from '@/lib/session';

/**
 * Exchange credentials for a session.
 *
 * The tokens never reach the browser: they are written as httpOnly cookies and
 * only the user profile is returned.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as { email?: string; password?: string };

  const upstream = await fetch(`${apiBaseUrl()}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password }),
    cache: 'no-store',
  });

  const payload = (await upstream.json()) as Record<string, unknown>;

  if (!upstream.ok) {
    return NextResponse.json(payload, { status: upstream.status });
  }

  const tokens = payload as unknown as {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: { companies: Array<{ id: string }> };
  };

  const response = NextResponse.json({ user: tokens.user });
  for (const cookie of sessionCookies(tokens)) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }

  // Default to the first accessible legal entity, so the app is usable on the
  // very first page load without the user choosing one.
  const firstCompany = tokens.user.companies[0]?.id;
  if (firstCompany) {
    response.cookies.set(COMPANY_COOKIE, firstCompany, {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return response;
}
