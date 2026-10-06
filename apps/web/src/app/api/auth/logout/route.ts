import { NextResponse } from 'next/server';
import { apiBaseUrl, clearedCookies, readSession } from '@/lib/session';

export async function POST(): Promise<NextResponse> {
  const { accessToken, refreshToken } = await readSession();

  // Revoke server-side too, so the refresh token cannot be replayed if it was
  // captured before the cookie was dropped.
  if (accessToken) {
    await fetch(`${apiBaseUrl()}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ refreshToken: refreshToken ?? undefined }),
      cache: 'no-store',
    }).catch(() => undefined);
  }

  const response = NextResponse.json({ ok: true });
  for (const name of clearedCookies()) {
    response.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
  return response;
}
