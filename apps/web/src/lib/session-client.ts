'use client';

import { COMPANY_COOKIE } from './cookie-names';

/** Read the active company from the non-httpOnly cookie the proxy also reads. */
export function activeCompanyId(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COMPANY_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

export async function switchCompany(companyId: string): Promise<void> {
  const response = await fetch(
    `/api/auth/company?companyId=${encodeURIComponent(companyId)}`,
    { method: 'POST' },
  );
  if (!response.ok) return;

  // A full reload is deliberate: every cached query is company-scoped, and
  // selectively invalidating them is a bug waiting to happen.
  window.location.reload();
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}
