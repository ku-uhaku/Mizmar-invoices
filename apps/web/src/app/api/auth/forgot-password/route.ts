import { NextResponse } from 'next/server';
import { apiBaseUrl } from '@/lib/session';

/** Public passthrough to the API; the API always answers ok to avoid enumeration. */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as { identifier?: string };
  const upstream = await fetch(`${apiBaseUrl()}/api/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: body.identifier }),
    cache: 'no-store',
  });
  const payload = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json(payload, { status: upstream.status });
}
