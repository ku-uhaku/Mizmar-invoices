'use client';

import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/provider';

/** Centered card shell shared by the public password-recovery pages. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const t = useT();
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-brand text-lg font-bold text-white shadow-sm dark:text-canvas">
            M
          </div>
          <span className="text-lg font-semibold tracking-tight text-ink">Mizmar</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">{t(title)}</h1>
        {subtitle && <p className="mb-8 mt-2 text-[15px] text-ink-muted">{t(subtitle)}</p>}
        {children}
      </div>
    </main>
  );
}
