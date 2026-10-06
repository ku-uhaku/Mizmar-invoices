import { cookies } from 'next/headers';
import { COMPANY_COOKIE } from './cookie-names';

/**
 * Tokens live in httpOnly cookies, never in the browser's JavaScript.
 *
 * Every API call goes through this app's proxy route, which attaches the access
 * token server-side. That keeps an XSS from reading a session, which
 * localStorage would not.
 */
export const ACCESS_COOKIE = 'mz_at';
export const REFRESH_COOKIE = 'mz_rt';
export { COMPANY_COOKIE } from './cookie-names';

const isProduction = process.env.NODE_ENV === 'production';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function readSession(): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
  companyId: string | null;
}> {
  const store = await cookies();
  return {
    accessToken: store.get(ACCESS_COOKIE)?.value ?? null,
    refreshToken: store.get(REFRESH_COOKIE)?.value ?? null,
    companyId: store.get(COMPANY_COOKIE)?.value ?? null,
  };
}

export function sessionCookies(tokens: SessionTokens): Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> {
  const base = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
  };

  return [
    {
      name: ACCESS_COOKIE,
      value: tokens.accessToken,
      // A little shorter than the token's own lifetime, so the cookie expires
      // before the token does and the proxy refreshes rather than 401s.
      options: { ...base, maxAge: Math.max(tokens.expiresIn - 30, 60) },
    },
    {
      name: REFRESH_COOKIE,
      value: tokens.refreshToken,
      options: { ...base, maxAge: 60 * 60 * 24 * 30 },
    },
  ];
}

export function clearedCookies(): string[] {
  return [ACCESS_COOKIE, REFRESH_COOKIE, COMPANY_COOKIE];
}

export const apiBaseUrl = (): string =>
  (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
