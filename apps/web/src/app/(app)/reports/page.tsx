'use client';

import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons';
import { Card, PageHeader } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

const REPORTS: Array<{ href: string; title: string; description: string; icon: IconName }> = [
  {
    href: '/reports/sales',
    title: 'Ventes',
    description: 'Chiffre d’affaires par période, client ou produit, avoirs déduits.',
    icon: 'trending',
  },
  {
    href: '/reports/vat',
    title: 'TVA',
    description: 'Base imposable et TVA par taux, ventes et achats, TVA nette due.',
    icon: 'invoice',
  },
  {
    href: '/reports/statements',
    title: 'Relevés de compte',
    description: 'Documents, paiements et solde courant d’un client ou fournisseur.',
    icon: 'file',
  },
  {
    href: '/reports/stock-valuation',
    title: 'Valorisation du stock',
    description: 'Quantités × coût moyen par entrepôt et par article.',
    icon: 'box',
  },
];

export default function ReportsIndexPage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('Rapports')} subtitle={t('Analyses et exports CSV')} />
      <div className="grid gap-4 sm:grid-cols-2">
        {REPORTS.map((report) => (
          <Link key={report.href} href={report.href}>
            <Card className="h-full p-5 transition hover:border-border-strong hover:shadow-md">
              <span className="mb-3 flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
                <Icon name={report.icon} />
              </span>
              <p className="font-semibold text-ink">{t(report.title)}</p>
              <p className="mt-1 text-sm text-ink-muted">{t(report.description)}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
