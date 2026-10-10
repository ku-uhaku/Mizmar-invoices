'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';

const LINKS = [
  { href: '/settings/company', label: 'Société' },
  { href: '/settings/vat-rates', label: 'TVA' },
  { href: '/settings/expense-categories', label: 'Catégories de dépenses' },
  { href: '/settings/pos', label: 'Caisse' },
  { href: '/settings/hr', label: 'Paramètres RH' },
  { href: '/settings/payroll', label: 'Taux de paie' },
  { href: '/settings/price-lists', label: 'Listes de prix' },
  { href: '/settings/exchange-rates', label: 'Taux de change' },
  { href: '/settings/numbering', label: 'Numérotation' },
  { href: '/settings/members', label: 'Membres' },
  { href: '/settings/templates', label: 'Modèles de document' },
  { href: '/settings/audit-log', label: 'Journal d’activité' },
  { href: '/settings/language', label: 'Langue & apparence' },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT();

  return (
    <div className="grid gap-5 lg:grid-cols-[13rem_1fr]">
      <nav
        aria-label={t('Paramètres')}
        className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 lg:sticky lg:top-20 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0"
      >
        {LINKS.map((link) => {
          const active = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition',
                active
                  ? 'bg-brand-soft text-brand'
                  : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
              )}
            >
              {t(link.label)}
            </Link>
          );
        })}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
