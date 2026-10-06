import { initClient, type ApiFetcher } from '@ts-rest/core';
import { apiContract, type ErrorBody } from '@mizmar/contracts';
import { clearSession, readSession, writeTokens } from './session';

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

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
}

type SessionLostHandler = () => void;
let onSessionLost: SessionLostHandler = () => undefined;
export function setSessionLostHandler(handler: SessionLostHandler): void {
  onSessionLost = handler;
}

/** Collapses concurrent refreshes so a burst of 401s triggers one rotation. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const { refreshToken } = await readSession();
    if (!refreshToken) return false;

    const response = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => null);

    if (!response?.ok) {
      await clearSession();
      onSessionLost();
      return false;
    }

    const tokens = (await response.json()) as { accessToken: string; refreshToken: string };
    await writeTokens(tokens.accessToken, tokens.refreshToken);
    return true;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

/**
 * The fetcher behind every API call.
 *
 * Attaches the token and the active company, and retries once after a silent
 * refresh — so a shift that started before lunch does not end in a login screen
 * halfway through counting a shelf.
 */
const fetcher: ApiFetcher = async (args) => {
  const send = async (token: string | null): Promise<Response> => {
    const { companyId } = await readSession();
    return fetch(args.path + (args.rawQuery ? `?${args.rawQuery}` : ''), {
      method: args.method,
      headers: {
        ...(args.headers as Record<string, string>),
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(companyId ? { 'x-company-id': companyId } : {}),
      },
      body:
        args.body === undefined || args.method === 'GET'
          ? undefined
          : typeof args.body === 'string'
            ? args.body
            : JSON.stringify(args.body),
    });
  };

  const { accessToken } = await readSession();
  let response = await send(accessToken);

  if (response.status === 401 && (await refreshTokens())) {
    const refreshed = await readSession();
    response = await send(refreshed.accessToken);
  }

  const text = await response.text();
  const body = text ? safeJson(text) : null;

  return {
    status: response.status,
    body,
    headers: response.headers,
  };
};

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = initClient(apiContract, {
  baseUrl: API_URL,
  baseHeaders: {},
  jsonQuery: true,
  api: fetcher,
});

export function unwrap<T extends { status: number; body: unknown }>(
  result: T,
): Extract<T, { status: 200 | 201 }>['body'] {
  if (result.status === 200 || result.status === 201) {
    return result.body as Extract<T, { status: 200 | 201 }>['body'];
  }

  const body = result.body as Partial<ErrorBody> | undefined;
  throw new ApiError(
    result.status,
    body?.code ?? 'ERROR',
    body?.message ?? 'Une erreur est survenue',
    body?.details,
  );
}

/** Sign in. Returns the session user so the caller can pick a company. */
export async function login(email: string, password: string) {
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      (body.code as string) ?? 'UNAUTHORIZED',
      (body.message as string) ?? 'Identifiants incorrects',
    );
  }

  const session = body as unknown as {
    accessToken: string;
    refreshToken: string;
    user: { companies: Array<{ id: string; code: string; name: string }> };
  };
  await writeTokens(session.accessToken, session.refreshToken);
  return session.user;
}

export { API_URL };
