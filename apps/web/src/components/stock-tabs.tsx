'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import type { BadgeTone } from './ui';

const TABS = [
  { href: '/stock', label: 'Stock' },
  { href: '/stock/warehouses', label: 'Entrepôts' },
  { href: '/stock/transfers', label: 'Transferts' },
  { href: '/stock/counts', label: 'Inventaires' },
];

/** Sub-navigation shared by every page of the stock area. */
export function StockTabs() {
  const t = useT();
  const pathname = usePathname();
  return (
    <nav
      aria-label={t('Stock')}
      className="no-scrollbar mb-5 flex gap-1 overflow-x-auto border-b border-border"
    >
      {TABS.map((tab) => {
        const active = tab.href === '/stock' ? pathname === '/stock' : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition',
              active
                ? 'border-brand text-brand'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t(tab.label)}
          </Link>
        );
      })}
    </nav>
  );
}

/** Count session status, shared by the list and the detail page. */
export const COUNT_STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  OPEN: { tone: 'info', label: 'Ouvert' },
  COUNTING: { tone: 'info', label: 'Comptage en cours' },
  REVIEW: { tone: 'progress', label: 'À valider' },
  POSTED: { tone: 'success', label: 'Validé' },
  ABANDONED: { tone: 'neutral', label: 'Abandonné' },
};
