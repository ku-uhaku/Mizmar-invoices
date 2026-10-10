'use client';

import { initClient, isErrorResponse, type ClientInferResponseBody } from '@ts-rest/core';
import { apiContract, moduleContract, type ErrorBody } from '@mizmar/contracts';

/**
 * The typed API client.
 *
 * Points at this app's proxy route rather than the API directly, so the access
 * token stays in an httpOnly cookie and refresh is handled server-side.
 * Types come straight from the contract, so a response shape that changes
 * breaks the build instead of the page.
 */
export const api = initClient(apiContract, {
  baseUrl: '/api/proxy',
  baseHeaders: {},
  jsonQuery: true,
  throwOnUnknownStatus: false,
});

/** HR (and later payroll) live in their own contract; same proxy, same conventions. */
export const apiModules = initClient(moduleContract, {
  baseUrl: '/api/proxy',
  baseHeaders: {},
  jsonQuery: true,
  throwOnUnknownStatus: false,
});

export type ApiContract = typeof apiContract;

/** An API error carrying the server's machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the user can fix this by changing their input. */
  get isUserFixable(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

type AnyResponse = { status: number; body: unknown };

/**
 * Narrow a ts-rest result to its success body, or throw a typed error.
 *
 * Every call site would otherwise repeat the same status check, and the one
 * that forgot it would render `undefined` into the page.
 */
export function unwrap<T extends AnyResponse>(
  result: T,
): Extract<T, { status: 200 | 201 }>['body'] {
  if (result.status === 200 || result.status === 201) {
    return result.body as Extract<T, { status: 200 | 201 }>['body'];
  }

  if (result.status === 401) {
    // The proxy already cleared the cookies; send the user to sign in.
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(401, 'UNAUTHORIZED', 'Your session has expired');
  }

  const body = result.body as Partial<ErrorBody> | undefined;
  throw new ApiError(
    result.status,
    body?.code ?? 'ERROR',
    body?.message ?? 'Something went wrong',
    body?.details,
  );
}

export { isErrorResponse };
export type { ClientInferResponseBody };
