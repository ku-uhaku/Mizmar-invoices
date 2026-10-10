'use client';

import { useQuery } from '@tanstack/react-query';
import type { treasurySchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { apiModules, unwrap } from './api';

export type PaymentMethodOption = z.infer<typeof treasurySchemas.paymentMethod>;

export const PAYMENT_METHODS_KEY = ['payment-methods'] as const;

/** The organization's payment methods, in the order the user arranged them. */
export function usePaymentMethods() {
  return useQuery({
    queryKey: PAYMENT_METHODS_KEY,
    queryFn: async () => unwrap(await apiModules.paymentMethods.list({})),
    staleTime: 5 * 60_000,
  });
}
