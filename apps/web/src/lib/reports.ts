'use client';

import { ApiError } from './api';

/**
 * Report endpoints return JSON, or a CSV file with `format=csv`, so they are
 * fetched directly through the proxy rather than through the typed ts-rest client.
 */
const BASE = '/api/proxy/api/v1/reports';

function url(path: string, params: Record<string, string | undefined>, extra?: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...extra })) {
    if (value) search.set(key, value);
  }
  return `${BASE}/${path}?${search.toString()}`;
}

async function failure(response: Response): Promise<ApiError> {
  if (response.status === 401 && typeof window !== 'undefined') {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
  return new ApiError(response.status, body.code ?? 'ERROR', body.message ?? 'Something went wrong');
}

export async function fetchReport<T>(
  path: string,
  params: Record<string, string | undefined>,
): Promise<T> {
  const response = await fetch(url(path, params), { cache: 'no-store' });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

/** Download the CSV version of a report through the browser's save dialog. */
export async function downloadReportCsv(
  path: string,
  params: Record<string, string | undefined>,
  decimal: 'dot' | 'comma' = 'comma',
): Promise<void> {
  const response = await fetch(url(path, params, { format: 'csv', decimal }), { cache: 'no-store' });
  if (!response.ok) throw await failure(response);

  const disposition = response.headers.get('content-disposition') ?? '';
  const fileName = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? `${path}.csv`;
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function startOfMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
}
