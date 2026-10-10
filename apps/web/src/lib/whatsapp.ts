'use client';

import { useQuery } from '@tanstack/react-query';
import { apiModules, unwrap } from '@/lib/api';

/** Gateway state; `configured` is what gates the "also send on WhatsApp" options. */
export function useWhatsappStatus() {
  return useQuery({
    queryKey: ['whatsapp', 'status'],
    queryFn: async () => unwrap(await apiModules.whatsapp.status()),
    staleTime: 60_000,
    retry: false,
  });
}

export function useWhatsappEnabled(): boolean {
  return useWhatsappStatus().data?.configured === true;
}
