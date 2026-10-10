'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n/provider';
import { Icon, type IconName } from '@/components/icons';
import { AgingChart, MonthlyChart, RankBars, SalesTrendChart } from '@/components/dashboard-charts';
import {
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
  Skeleton,
  StatCard,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { date, dateTime, documentTypeLabel, money, movementTypeLabel, paymentMethodLabel, qty } from '@/lib/format';

interface Activity {
  kind: string;
  label: string;
  at: string;
  userName?: string | null;
  documentId?: string | null;
  documentType?: string | null;
  amount?: string | null;
}

/**
 * The API sends machine-ish labels ("ADJUSTMENT SKU @ WH (-2.000000)"); turn
 * them into something a person would say, without changing the API contract.
 */
function describe(
  entry: Activity,
  t: (fr: string, params?: Record<string, string | number>) => string,
): { icon: IconName; tone: string; title: string; detail: string; delta?: string } {
  if (entry.kind === 'STOCK') {
    const match = /^(\S+) (\S+) @ (\S+) \((-?[\d.]+)\)$/.exec(entry.label);
    if (match) {
      const [, type, sku, warehouse, quantity] = match;
      return {
        icon: 'box',
        tone: 'bg-warning-soft text-warning',
        title: movementTypeLabel(type!),
        detail: `${sku} · ${warehouse}`,
        delta: `${Number(quantity) > 0 ? '+' : ''}${qty(quantity)}`,
      };
    }
    return { icon: 'box', tone: 'bg-warning-soft text-warning', title: entry.label, detail: '' };
  }
  if (entry.kind === 'PAYMENT') {
    const match = /^Payment (\S+) — (.+)$/.exec(entry.label);
    return {
      icon: 'wallet',
      tone: 'bg-positive-soft text-positive',
      title: match ? t('Règlement de {name}', { name: match[2]! }) : entry.label,
      detail: match ? paymentMethodLabel(match[1]!) : '',
    };
  }
  const [number, ...rest] = entry.label.split(' — ');
  const party = rest.join(' — ');
  return {
    icon: 'file',
    tone: 'bg-info-soft text-info',
    title: number === 'Draft' ? t('Brouillon · {party}', { party }) : `${number} · ${party}`,
    detail: entry.documentType ? documentTypeLabel(entry.documentType) : '',
  };
}

const DATE_LOCALES = { FR: 'fr-FR', EN: 'en-GB', AR: 'ar-MA-u-nu-latn' } as const;

function DashboardSkeleton() {
  const t = useT();
  return (
    <div className="space-y-4" role="status" aria-label={t('Chargement')}>
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 rounded-card" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-card lg:col-span-2" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const t = useT();
  const locale = useLocale();
  const { data, isPending, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => unwrap(await api.dashboard.get({ query: {} })),
  });
  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => unwrap(await api.auth.me()),
    staleTime: 5 * 60_000,
  });

  if (isPending) return <DashboardSkeleton />;

  if (error || !data) {
    return (
      <Card>
        <EmptyState
          icon="alert"
          title={t('Impossible de charger le tableau de bord')}
          description={t('Vérifiez votre connexion puis réessayez.')}
          action={<LinkButton href="/dashboard">{t('Réessayer')}</LinkButton>}
        />
      </Card>
    );
  }

  const currency = data.currency;
  const totals = data.salesTrend.map((point) => Number(point.total));
  const trendSum = totals.reduce((sum, value) => sum + value, 0);
  const hasSales = trendSum > 0;
  const overdue = Number(data.receivables.overdue) > 0;
  const fmt = (value: number) => money(String(value), currency);
  const trendData = data.salesTrend.map((point, index) => ({
    date: point.date,
    invoiced: Number(point.total),
    collected: Number(data.collectedTrend[index]?.total ?? 0),
  }));
  const collectedSum = data.collectedTrend.reduce((sum, point) => sum + Number(point.total), 0);
  const formatMonth = (month: string) =>
    new Intl.DateTimeFormat(DATE_LOCALES[locale], { month: 'short' }).format(new Date(`${month}-01T12:00:00Z`));
  const agingLabels = {
    CURRENT: t('Non échu'),
    D1_30: '1–30 j',
    D31_60: '31–60 j',
    D61_90: '61–90 j',
    D90_PLUS: '90+ j',
  } as const;
  const agingData = data.receivablesAging.map((row) => ({
    bucket: row.bucket,
    label: agingLabels[row.bucket],
    amount: Number(row.amount),
  }));
  const hasAging = agingData.some((row) => row.amount > 0);
  const hasMonthly = data.monthlyTrend.some((row) => Number(row.total) > 0);
  const previous = Number(data.sales.previousInvoiced);
  const current = Number(data.sales.invoicedPeriod);
  const delta = previous > 0 ? ((current - previous) / previous) * 100 : null;
  const firstName = session.data?.fullName?.split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 5 ? t('Bonsoir') : hour < 18 ? t('Bonjour') : t('Bonsoir');
  const pendingTotal =
    data.pending.draftDocumentCount +
    data.pending.ordersAwaitingDelivery +
    data.pending.deliveriesAwaitingInvoice +
    data.receivables.overdueDocumentCount;

  return (
    <>
      <PageHeader
        title={`${greeting}${firstName ? `, ${firstName}` : ''}`}
        subtitle={new Intl.DateTimeFormat(DATE_LOCALES[locale], {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }).format(new Date())}
        actions={
          <>
            <LinkButton href="/documents/new?type=DEVIS">{t('Nouveau devis')}</LinkButton>
            <LinkButton variant="primary" href="/documents/new?type=SALES_INVOICE">
              <Icon name="plus" /> {t('Nouvelle facture')}
            </LinkButton>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          icon="trending"
          label={t('Ventes du jour')}
          value={money(data.sales.today, currency)}
          hint={t('Total HT facturé aujourd’hui')}
        />
        <StatCard
          icon="invoice"
          label={t('Ventes du mois')}
          value={money(data.sales.invoicedPeriod, currency)}
          hint={
            <>
              {delta !== null && (
                <span
                  className={clsx(
                    'tabular me-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 font-semibold',
                    delta >= 0 ? 'bg-positive-soft text-positive' : 'bg-danger-soft text-danger',
                  )}
                >
                  {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)} %
                </span>
              )}
              {t('{count} facture(s) · {amount} encaissés', {
                count: data.sales.documentCount,
                amount: money(data.sales.collectedPeriod, currency),
              })}
            </>
          }
          href="/documents?type=SALES_INVOICE"
        />
        <StatCard
          icon="wallet"
          label={t('Encours client')}
          value={money(data.receivables.outstanding, currency)}
          hint={
            overdue
              ? t('dont {amount} en retard', { amount: money(data.receivables.overdue, currency) })
              : t('Aucun retard de paiement')
          }
          tone={overdue ? 'danger' : 'success'}
          href={overdue ? '/receivables' : '/documents?settlement=UNPAID'}
        />
        <StatCard
          icon="box"
          label={t('Alertes stock')}
          value={data.stock.lowStockVariantCount}
          hint={`${t('{count} en rupture', { count: data.stock.outOfStockVariantCount })}${data.stock.totalStockValue ? ` · ${t('stock valorisé {amount}', { amount: money(data.stock.totalStockValue, currency) })}` : ''}`}
          tone={data.stock.lowStockVariantCount > 0 ? 'progress' : 'success'}
          href="/stock?filter=low"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={t('Ventes sur 30 jours')}
            description={t('Total HT facturé et encaissements par jour')}
            actions={
              hasSales && (
                <div className="text-end">
                  <p className="tabular text-sm font-semibold text-ink">{money(String(trendSum), currency)}</p>
                  <p className="text-xs text-ink-muted">{t('sur la période')}</p>
                </div>
              )
            }
          />
          {hasSales ? (
            <div className="px-3 pb-4 pt-5 sm:px-5">
              <SalesTrendChart
                data={trendData}
                invoicedLabel={t('Facturé')}
                collectedLabel={t('Encaissé')}
                formatDay={date}
                format={fmt}
              />
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                <span className="flex items-center gap-2">
                  <span className="h-0.5 w-4 rounded bg-(--series-1)" /> {t('Facturé')}
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-0.5 w-4 rounded bg-(--series-3)" /> {t('Encaissé')} · {money(String(collectedSum), currency)}
                </span>
              </div>
            </div>
          ) : (
            <EmptyState
              icon="trending"
              title={t('Pas encore de ventes sur la période')}
              description={t('Dès qu’une facture est validée, son montant apparaît ici jour après jour.')}
              action={
                <LinkButton variant="primary" href="/documents/new?type=SALES_INVOICE">
                  {t('Créer une facture')}
                </LinkButton>
              }
            />
          )}
        </Card>

        <Card>
          <CardHeader title={t('À traiter')} description={t('Ce qui attend une action de votre part')} />
          {pendingTotal === 0 ? (
            <EmptyState icon="check" title={t('Tout est à jour')} description={t('Rien ne demande votre attention.')} />
          ) : (
            <ul className="p-2">
              <Pending
                label={t('Brouillons à valider')}
                count={data.pending.draftDocumentCount}
                href="/documents?lifecycle=DRAFT"
              />
              <Pending
                label={t('Commandes à livrer')}
                count={data.pending.ordersAwaitingDelivery}
                href="/documents?type=SALES_ORDER&fulfilment=PENDING"
              />
              <Pending
                label={t('Livraisons à facturer')}
                count={data.pending.deliveriesAwaitingInvoice}
                href="/documents?type=DELIVERY_NOTE&fulfilment=PENDING"
              />
              <Pending
                label={t('Factures en retard')}
                count={data.receivables.overdueDocumentCount}
                href="/receivables"
                tone="danger"
              />
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('Ventes sur 6 mois')} description={t('Total HT facturé par mois')} />
          {hasMonthly ? (
            <div className="px-3 pb-4 pt-5 sm:px-5">
              <MonthlyChart
                data={data.monthlyTrend.map((row) => ({ month: row.month, total: Number(row.total) }))}
                label={t('Facturé')}
                formatMonth={formatMonth}
                format={fmt}
              />
            </div>
          ) : (
            <EmptyState icon="trending" title={t('Pas encore de ventes')} description={t('L’historique mensuel apparaîtra ici.')} />
          )}
        </Card>

        <Card>
          <CardHeader
            title={t('Créances par ancienneté')}
            description={t('Factures impayées selon leur retard')}
            actions={
              <Link href="/receivables" className="text-sm font-medium text-brand hover:underline">
                {t('Tout voir')}
              </Link>
            }
          />
          {hasAging ? (
            <div className="px-3 pb-4 pt-5 sm:px-5">
              <AgingChart data={agingData} label={t('Montant dû')} format={fmt} />
            </div>
          ) : (
            <EmptyState icon="check" title={t('Aucune créance ouverte')} description={t('Toutes les factures sont réglées.')} />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('Meilleurs clients du mois')} description={t('Classés par total HT facturé')} />
          {data.topClients.length === 0 ? (
            <EmptyState icon="users" title={t('Pas encore de clients facturés')} description={t('Le classement apparaît dès la première facture.')} />
          ) : (
            <RankBars
              rows={data.topClients.map((client) => ({
                key: client.contactId,
                name: client.contactName,
                value: Number(client.total),
                display: money(client.total, currency),
              }))}
            />
          )}
        </Card>

        <Card>
          <CardHeader title={t('Meilleurs produits du mois')} description={t('Classés par total HT vendu')} />
          {data.topProducts.length === 0 ? (
            <EmptyState icon="box" title={t('Pas encore de ventes')} description={t('Les articles les plus vendus apparaîtront ici.')} />
          ) : (
            <RankBars
              rows={data.topProducts.map((product, index) => ({
                key: `${product.sku ?? product.description}-${index}`,
                name: product.description,
                sub: `× ${qty(product.quantity)}`,
                value: Number(product.total),
                display: money(product.total, currency),
              }))}
            />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t('Stock à surveiller')}
            description={t('Variantes sous leur seuil d’alerte')}
            actions={
              <Link href="/stock?filter=low" className="text-sm font-medium text-brand hover:underline">
                {t('Tout voir')}
              </Link>
            }
          />
          {data.lowStockAlerts.length === 0 ? (
            <EmptyState icon="check" title={t('Aucune alerte')}
              description={t('Toutes les variantes sont au-dessus de leur seuil.')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('Article')}</Th>
                  <Th>{t('Dépôt')}</Th>
                  <Th numeric>{t('Stock')}</Th>
                  <Th numeric>{t('Seuil')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.lowStockAlerts.slice(0, 8).map((alert) => (
                  <tr key={`${alert.variantId}-${alert.warehouseCode}`} className="hover:bg-surface-muted/60">
                    <Td>
                      <div className="font-medium">{alert.productName}</div>
                      <div className="text-xs text-ink-muted">
                        {alert.sku}
                        {alert.variantLabel ? ` · ${alert.variantLabel}` : ''}
                      </div>
                    </Td>
                    <Td className="text-ink-muted">{alert.warehouseCode}</Td>
                    <Td numeric>
                      <span className={Number(alert.onHand) <= 0 ? 'font-semibold text-danger' : 'font-semibold text-warning'}>
                        {qty(alert.onHand)}
                      </span>
                    </Td>
                    <Td numeric className="text-ink-muted">{qty(alert.minStockThreshold)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title={t('Activité récente')} description={t('Documents, règlements et mouvements de stock')} />
          {data.recentActivity.length === 0 ? (
            <EmptyState icon="clock" title={t('Rien pour l’instant')}
              description={t('L’activité de l’équipe s’affichera ici.')} />
          ) : (
            <ul className="divide-y divide-border/70">
              {data.recentActivity.slice(0, 8).map((entry, index) => {
                const view = describe(entry as Activity, t);
                const row = (
                  <div className="flex items-center gap-3 px-5 py-3">
                    <span className={clsx('flex size-9 shrink-0 items-center justify-center rounded-xl', view.tone)}>
                      <Icon name={view.icon} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{view.title}</p>
                      <p className="truncate text-xs text-ink-muted">
                        {[view.detail, dateTime(entry.at), entry.userName].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {(entry.amount || view.delta) && (
                      <span
                        className={clsx(
                          'tabular shrink-0 text-sm font-medium',
                          view.delta?.startsWith('-') ? 'text-danger' : view.delta ? 'text-positive' : 'text-ink',
                        )}
                      >
                        {view.delta ?? money(entry.amount, currency)}
                      </span>
                    )}
                  </div>
                );
                return (
                  <li key={`${entry.at}-${index}`}>
                    {entry.documentId ? (
                      <Link href={`/documents/${entry.documentId}`} className="block hover:bg-surface-muted/60">
                        {row}
                      </Link>
                    ) : (
                      row
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

    </>
  );
}

function Pending({
  label,
  count,
  href,
  tone,
}: {
  label: string;
  count: number;
  href: string;
  tone?: 'danger';
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex h-12 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-surface-muted"
      >
        <span
          className={clsx(
            'tabular flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold',
            count === 0
              ? 'bg-surface-muted text-ink-subtle'
              : tone === 'danger'
                ? 'bg-danger-soft text-danger'
                : 'bg-brand-soft text-brand',
          )}
        >
          {count}
        </span>
        <span className={clsx('flex-1 text-sm', count === 0 ? 'text-ink-muted' : 'font-medium text-ink')}>
          {label}
        </span>
        <Icon
          name="chevronRight"
          className="text-ink-subtle transition-transform group-hover:translate-x-0.5 rtl:rotate-180"
        />
      </Link>
    </li>
  );
}
