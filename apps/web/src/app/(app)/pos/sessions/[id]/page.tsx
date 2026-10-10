'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import { CloseSessionDialog, MovementDialog, REASONS, useSessionDetail } from '@/components/cash-dialogs';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  StatCard,
  Table,
  TableSkeleton,
  Td,
  Th,
} from '@/components/ui';
import { dateTime, money, paymentMethodLabel } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

/** The Z report of one cash session. */
export default function CashSessionPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const session = useSessionDetail(id);
  const [dialog, setDialog] = useState<'move' | 'close' | null>(null);

  if (session.isPending) return <TableSkeleton rows={4} cols={4} />;
  if (session.isError) return <ErrorNote>{t('Chargement impossible')}</ErrorNote>;
  const s = session.data;
  const open = s.status === 'OPEN';
  const diff = s.difference === null ? null : Number(s.difference);
  const cur = s.currency;

  return (
    <>
      <PageHeader
        title={
          <>
            {s.registerName} · {t('Session {n}', { n: s.number })}
            <Badge tone={open ? 'info' : 'neutral'} className="ms-3 align-middle">
              {open ? t('Ouverte') : t('Clôturée')}
            </Badge>
          </>
        }
        subtitle={`${dateTime(s.openedAt)} — ${s.openedByName}${s.closedAt ? ` → ${dateTime(s.closedAt)}` : ''}`}
        actions={
          <>
            <Link href="/pos/sessions" className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink">
              {t('Retour')}
            </Link>
            <a
              href={`/cash-report/${s.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-strong px-3 text-sm font-medium text-ink hover:bg-surface-muted"
            >
              <Icon name="printer" className="size-4" />
              {t('Rapport Z')}
            </a>
            {open && (
              <>
                <Button variant="secondary" onClick={() => setDialog('move')}>
                  {t('Entrée / sortie')}
                </Button>
                <Button variant="danger" onClick={() => setDialog('close')}>
                  {t('Clôturer')}
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Ventes')} value={money(s.salesTotal, cur)} hint={t('{n} encaissement(s)', { n: s.salesCount })} icon="cart" />
        <StatCard label={t('Espèces attendues')} value={money(s.expectedCash, cur)} icon="wallet" />
        <StatCard label={t('Espèces comptées')} value={s.countedCash ? money(s.countedCash, cur) : '—'} icon="check" />
        <StatCard
          label={t('Écart')}
          value={diff === null ? '—' : money(s.difference, cur)}
          icon={diff !== null && Math.abs(diff) >= 0.005 ? 'alert' : 'check'}
          tone={diff === null ? 'neutral' : Math.abs(diff) < 0.005 ? 'success' : 'danger'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t('Calcul des espèces')}</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
            <dt className="text-ink-muted">{t('Fonds de caisse')}</dt>
            <dd className="tabular">{money(s.openingFloat, cur)}</dd>
            <dt className="text-ink-muted">{t('Ventes en espèces')}</dt>
            <dd className="tabular">+ {money(s.cashSales, cur)}</dd>
            <dt className="text-ink-muted">{t('Entrées d’espèces')}</dt>
            <dd className="tabular">+ {money(s.cashIn, cur)}</dd>
            <dt className="text-ink-muted">{t('Sorties d’espèces')}</dt>
            <dd className="tabular">− {money(s.cashOut, cur)}</dd>
            <dt className="border-t border-border pt-1.5 font-semibold text-ink">{t('Espèces attendues')}</dt>
            <dd className="tabular border-t border-border pt-1.5 font-semibold">{money(s.expectedCash, cur)}</dd>
          </dl>
          {(s.openingNote || s.closingNote) && (
            <p className="mt-3 text-xs text-ink-muted">
              {[s.openingNote, s.closingNote].filter(Boolean).join(' · ')}
            </p>
          )}
        </Card>

        <Card className="overflow-hidden">
          <h2 className="px-5 py-3 text-sm font-semibold text-ink">{t('Ventes par moyen de paiement')}</h2>
          {s.byMethod.length > 0 ? (
            <Table>
              <tbody>
                {s.byMethod.map((row) => (
                  <tr key={row.method}>
                    <Td>{paymentMethodLabel(row.method)}</Td>
                    <Td numeric className="text-ink-muted">{row.count}</Td>
                    <Td numeric className="font-medium">{money(row.amount, cur)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState icon="cart" title={t('Aucune vente')} />
          )}
        </Card>

        <Card className="overflow-hidden">
          <h2 className="px-5 py-3 text-sm font-semibold text-ink">{t('Mouvements d’espèces')}</h2>
          {s.movements.length > 0 ? (
            <Table>
              <tbody>
                {s.movements.map((m) => (
                  <tr key={m.id}>
                    <Td className="whitespace-nowrap text-ink-muted">{dateTime(m.createdAt)}</Td>
                    <Td>
                      {t(REASONS.find(([value]) => value === m.reason)?.[1] ?? m.reason)}
                      {m.note && <div className="text-xs text-ink-muted">{m.note}</div>}
                    </Td>
                    <Td numeric className={m.type === 'IN' ? 'text-positive' : 'text-danger'}>
                      {m.type === 'IN' ? '+' : '−'} {money(m.amount, cur)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState icon="wallet" title={t('Aucun mouvement')} />
          )}
        </Card>

        <Card className="overflow-hidden">
          <h2 className="px-5 py-3 text-sm font-semibold text-ink">{t('Encaissements')}</h2>
          {s.sales.length > 0 ? (
            <Table>
              <tbody>
                {s.sales.map((sale) => (
                  <tr key={sale.paymentId}>
                    <Td className="whitespace-nowrap text-ink-muted">{dateTime(sale.time)}</Td>
                    <Td>{sale.documentNumbers.join(', ') || '—'}</Td>
                    <Td className="text-ink-muted">{paymentMethodLabel(sale.method)}</Td>
                    <Td numeric className="font-medium">{money(sale.amount, cur)}</Td>
                    <Td className="w-8">
                      <a href={`/receipt/${sale.paymentId}`} target="_blank" rel="noreferrer" aria-label={t('Reçu')} className="text-ink-muted hover:text-ink">
                        <Icon name="printer" className="size-4" />
                      </a>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState icon="cart" title={t('Aucun encaissement')} />
          )}
        </Card>
      </div>

      {dialog === 'move' && <MovementDialog sessionId={s.id} currency={cur} onClose={() => setDialog(null)} />}
      {dialog === 'close' && <CloseSessionDialog session={s} onClose={() => setDialog(null)} onClosed={() => setDialog(null)} />}
    </>
  );
}
