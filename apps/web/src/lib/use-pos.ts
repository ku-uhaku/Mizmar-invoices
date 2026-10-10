'use client';

import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './api';
import { activeCompanyId } from './session-client';

/** Caisse switches of the active company, read from the cached session. */
export function usePosSettings() {
  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => unwrap(await api.auth.me()),
    staleTime: 5 * 60_000,
  });
  const companies = session.data?.companies ?? [];
  const id = activeCompanyId();
  const company = companies.find((c) => c.id === id) ?? companies[0];
  return {
    ready: session.isSuccess && Boolean(company),
    companyId: company?.id ?? null,
    currency: company?.defaultCurrency ?? 'MAD',
    /** Defaults to on until the session has loaded, so the menu never flickers away. */
    enabled: company?.posEnabled ?? true,
    requireSession: company?.posRequireSession ?? false,
  };
}
