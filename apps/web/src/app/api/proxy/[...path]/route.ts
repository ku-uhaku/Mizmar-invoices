import { NextResponse } from 'next/server';
import { apiBaseUrl, clearedCookies, readSession, sessionCookies } from '@/lib/session';

/**
 * The single door between the browser and the API.
 *
 * It attaches the access token from an httpOnly cookie, scopes the request to
 * the active company, and transparently refreshes an expired session once
 * before giving up. The browser therefore never holds a credential and never
 * has to implement retry-on-401 itself.
 */
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const { accessToken, refreshToken, companyId } = await readSession();

  const url = new URL(request.url);
  // A pure pass-through: the contract already carries the /api/v1 prefix, so
  // adding it here would double it.
  const target = `${apiBaseUrl()}/${path.join('/')}${url.search}`;

  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.arrayBuffer();

  const send = async (token: string | null): Promise<Response> =>
    fetch(target, {
      method: request.method,
      headers: {
        'content-type': request.headers.get('content-type') ?? 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(companyId ? { 'x-company-id': companyId } : {}),
      },
      body: body && body.byteLength > 0 ? body : undefined,
      cache: 'no-store',
    });

  let upstream = await send(accessToken);
  let refreshed: Awaited<ReturnType<typeof refreshSession>> = null;

  if (upstream.status === 401 && refreshToken) {
    refreshed = await refreshSession(refreshToken);
    if (refreshed) {
      upstream = await send(refreshed.accessToken);
    }
  }

  const payload = await upstream.arrayBuffer();
  const response = new NextResponse(payload, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      // Product pictures are immutable per id; let the browser keep them.
      ...(upstream.headers.get('cache-control')
        ? { 'cache-control': upstream.headers.get('cache-control')! }
        : {}),
    },
  });

  if (refreshed) {
    for (const cookie of sessionCookies(refreshed)) {
      response.cookies.set(cookie.name, cookie.value, cookie.options);
    }
  } else if (upstream.status === 401) {
    // The session is genuinely gone; drop the cookies so the UI redirects to
    // sign-in instead of looping on a dead token.
    for (const name of clearedCookies()) {
      response.cookies.set(name, '', { path: '/', maxAge: 0 });
    }
  }

  return response;
}

async function refreshSession(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  const response = await fetch(`${apiBaseUrl()}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  }).catch(() => null);

  if (!response?.ok) return null;
  return (await response.json()) as {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;

export const dynamic = 'force-dynamic';
