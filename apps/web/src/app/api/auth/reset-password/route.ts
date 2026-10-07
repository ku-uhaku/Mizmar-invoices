import { NextResponse } from 'next/server';
import { apiBaseUrl } from '@/lib/session';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as { token?: string; newPassword?: string };
  const upstream = await fetch(`${apiBaseUrl()}/api/v1/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: body.token, newPassword: body.newPassword }),
    cache: 'no-store',
  });
  const payload = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json(payload, { status: upstream.status });
}
