'use client';

import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './api';

/** Mirrors the API rules in packages/core abilities; the server remains the authority. */
export function useRole() {
  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => unwrap(await api.auth.me()),
    staleTime: 5 * 60_000,
  });
  const role = session.data?.role;
  return {
    role,
    ready: session.isSuccess,
    /** Salaries, bank details and payroll. */
    canSeePay: role === 'OWNER' || role === 'ADMIN' || role === 'ACCOUNTANT',
    /** Create and edit employees, decide leave, record attendance. */
    canManageHr: role === 'OWNER' || role === 'ADMIN',
  };
}
