'use client';

import { useQuery } from '@tanstack/react-query';
import { apiModules, unwrap } from './api';

export const ACCOUNTS_KEY = ['accounting', 'accounts'] as const;

export function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: async () => unwrap(await apiModules.accounting.listAccounts({})),
  });
}

export const yearStart = () => `${new Date().getFullYear()}-01-01`;
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Download rows as a ; separated CSV that Excel opens with accents intact. */
export function downloadCsv(name: string, rows: string[][]): void {
  const body = rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
