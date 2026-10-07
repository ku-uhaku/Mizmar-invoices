'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { DocumentDetail } from '@mizmar/contracts';
import { api, unwrap } from '@/lib/api';
import { useT } from '@/lib/i18n/provider';
import { Card, CardHeader, Table, Td, Th } from './ui';
import { ReminderHistory } from './reminder-history';
import { DocBadges } from './doc-badges';
import { Icon } from './icons';
import { amount, date, documentTypeLabel, money, paymentMethodLabel, percent } from '@/lib/format';

/** Read-only rendering of a validated document: immutable, so nothing is editable. */
export function DocumentView({ document }: { document: DocumentDetail }) {
  const t = useT();
  const currency = document.currency;

  // The detail payload carries no payment list, so pull the contact's payments
  // and keep the allocations that point at this document.
  const settles = document.settlement !== 'NOT_APPLICABLE';
  const payments = useQuery({
    queryKey: ['payments', 'document', document.id, document.paidAmount],
    enabled: settles && Number(document.paidAmount) > 0,
    queryFn: async () =>
      unwrap(await api.payments.list({ query: { contactId: document.contactId, limit: 200 } })),
  });
  const documentPayments = (payments.data?.items ?? [])
    .map((payment) => ({
      payment,
      allocated: payment.allocations
        .filter((allocation) => allocation.documentId === document.id)
        .reduce((sum, allocation) => sum + Number(allocation.amount), 0),
    }))
    .filter((entry) => entry.allocated > 0);
  const hasPaid = Number(document.paidAmount) > 0;
  const due = Number(document.outstandingAmount);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader title={t('Informations')} />
          <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-3">
            <Info label={t('Tiers')}>
              <Link href={`/contacts/${document.contactId}`} className="text-brand hover:underline">
                {document.contactName}
              </Link>
              {document.contactIce && (
                <div className="text-xs text-ink-subtle">{t('ICE')} {document.contactIce}</div>
              )}
            </Info>
            <Info label={t('Date')}>{date(document.issueDate)}</Info>
            {document.dueDate && (
              <Info label={t('Échéance')}>
                <span className={document.isOverdue ? 'font-medium text-danger' : undefined}>
                  {date(document.dueDate)}
                </span>
              </Info>
            )}
            {document.validUntil && (
              <Info label={t('Valable jusqu’au')}>{date(document.validUntil)}</Info>
            )}
            {document.reference && <Info label={t('Référence')}>{document.reference}</Info>}
            {document.projectName && <Info label={t('Projet')}>{document.projectName}</Info>}
            <Info label={t('Créé par')}>{document.createdByName ?? '—'}</Info>
          </dl>
        </Card>

        <Card>
          <CardHeader title={t('Lignes')} />
          <Table>
            <thead>
              <tr>
                <Th className="w-8">#</Th>
                <Th>{t('Désignation')}</Th>
                <Th numeric>{t('Qté')}</Th>
                <Th numeric>{t('P.U. HT')}</Th>
                <Th numeric>{t('Remise')}</Th>
                <Th numeric>{t('TVA')}</Th>
                <Th numeric>{t('Total HT')}</Th>
              </tr>
            </thead>
            <tbody>
              {document.lines.map((line, index) =>
                line.isNote ? (
                  <tr key={line.id} className="bg-surface-muted/50">
                    <Td />
                    <Td colSpan={6} className="font-medium text-brand">
                      {line.description}
                    </Td>
                  </tr>
                ) : (
                  <tr key={line.id}>
                    <Td className="text-ink-subtle tabular">{index + 1}</Td>
                    <Td>
                      <div className="font-medium">{line.description}</div>
                      <div className="text-xs text-ink-subtle">
                        {line.sku}
                        {line.variantLabel ? ` · ${line.variantLabel}` : ''}
                        {line.sources[0]?.sourceDocumentNumber && (
                          <span className="text-brand">
                            {' '}
                            · {t('issue de {number}', { number: line.sources[0].sourceDocumentNumber })}
                          </span>
                        )}
                      </div>
                      {/* Remaining quantity is what the next conversion will offer. */}
                      {Number(line.drawnQuantity) > 0 && (
                        <div className="text-xs text-ink-subtle">
                          {t('{done} traitée(s) · {left} restante(s)', {
                            done: amount(line.drawnQuantity),
                            left: amount(line.remainingQuantity),
                          })}
                        </div>
                      )}
                    </Td>
                    <Td numeric>{amount(line.quantity)}</Td>
                    <Td numeric>{money(line.unitPrice, currency)}</Td>
                    <Td numeric className="text-ink-muted">
                      {line.discountKind
                        ? line.discountKind === 'PERCENT'
                          ? percent(line.discountValue)
                          : money(line.discountValue, currency)
                        : '—'}
                    </Td>
                    <Td numeric className="text-ink-muted">
                      {percent(line.vatRate)}
                    </Td>
                    <Td numeric className="font-medium">
                      {money(line.taxableBase, currency)}
                    </Td>
                  </tr>
                ),
              )}
            </tbody>
          </Table>
        </Card>

        {(document.notes || document.terms) && (
          <Card>
            <CardHeader title={t('Notes et conditions')} />
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              {document.notes && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    {t('Observations')}
                  </p>
                  <p className="whitespace-pre-line text-sm text-ink">{document.notes}</p>
                </div>
              )}
              {document.terms && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    {t('Conditions')}
                  </p>
                  <p className="whitespace-pre-line text-sm text-ink">{document.terms}</p>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <Card>
          <CardHeader title={t('Totaux')} />
          <div className="space-y-2 p-5 text-sm">
            <Row label={t('Sous-total')} value={money(document.totals.subtotalGross, currency)} />
            {document.totals.totalLineDiscounts !== '0.00' && (
              <Row
                label={t('Remises lignes')}
                value={`− ${money(document.totals.totalLineDiscounts, currency)}`}
              />
            )}
            {document.totals.globalDiscount !== '0.00' && (
              <Row
                label={t('Remise globale')}
                value={`− ${money(document.totals.globalDiscount, currency)}`}
              />
            )}
            <div className="my-2 border-t border-border" />
            <Row label={t('Total HT')} value={money(document.totals.totalExclVat, currency)} strong />
            {document.vatBreakdown.map((bucket) => (
              <Row
                key={bucket.rate}
                label={`${t('TVA')} ${percent(bucket.rate)}`}
                value={money(bucket.amount, currency)}
                small
              />
            ))}
            <Row label={t('Total TVA')} value={money(document.totals.totalVat, currency)} />
          </div>

          <div className="space-y-3 border-t border-border bg-surface-muted/50 p-4 rounded-b-card">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-ink">{t('Total TTC')}</span>
              <span className="tabular text-2xl font-semibold tracking-tight text-ink">
                {money(document.totals.totalInclVat, currency)}
              </span>
            </div>
            {hasPaid && (
              <>
                <Row label={t('Déjà payé')} value={`− ${money(document.paidAmount, currency)}`} />
                <div
                  className={`flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 ${
                    due > 0 ? 'bg-warning-soft text-warning' : 'bg-positive-soft text-positive'
                  }`}
                >
                  <span className="text-sm font-semibold">{due > 0 ? t('Reste dû') : t('Soldé')}</span>
                  <span className="tabular text-lg font-semibold">
                    {money(document.outstandingAmount, currency)}
                  </span>
                </div>
              </>
            )}
            {!hasPaid && settles && due > 0 && (
              <Row label={t('Reste dû')} value={money(document.outstandingAmount, currency)} />
            )}
          </div>
        </Card>

        {document.type === 'SALES_INVOICE' && settles && <ReminderHistory documentId={document.id} />}

        {documentPayments.length > 0 && (
          <Card>
            <CardHeader
              title={t('Règlements')}
              description={t('{n} enregistré(s)', { n: documentPayments.length })}
            />
            <ul className="divide-y divide-border/70">
              {documentPayments.map(({ payment, allocated }) => (
                <li key={payment.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-positive-soft text-positive">
                    <Icon name="wallet" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{paymentMethodLabel(payment.method)}</p>
                    <p className="truncate text-xs text-ink-muted">
                      {date(payment.paidAt)}
                      {payment.reference ? ` · ${payment.reference}` : ''}
                    </p>
                  </div>
                  <span className="tabular font-medium text-ink">
                    {money(allocated.toFixed(2), currency)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {(document.links.convertedFrom.length > 0 || document.links.convertedTo.length > 0) && (
          <Card>
            <CardHeader title={t('Chaîne documentaire')} />
            <div className="space-y-4 p-5 text-sm">
              {document.links.convertedFrom.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                    {t('Créé à partir de')}
                  </p>
                  <ul className="space-y-1.5">
                    {document.links.convertedFrom.map((link) => (
                      <LinkedDoc key={link.id} link={link} />
                    ))}
                  </ul>
                </div>
              )}
              {document.links.convertedTo.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                    {t('A donné lieu à')}
                  </p>
                  <ul className="space-y-1.5">
                    {document.links.convertedTo.map((link) => (
                      <LinkedDoc key={link.id} link={link} badge />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function LinkedDoc({
  link,
  badge,
}: {
  link: DocumentDetail['links']['convertedFrom'][number] & { lifecycle?: string };
  badge?: boolean;
}) {
  return (
    <li>
      <Link
        href={`/documents/${link.id}`}
        className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 transition hover:border-border-strong hover:bg-surface-muted"
      >
        <Icon name="file" className="text-ink-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink">
            {link.number ?? documentTypeLabel(link.type)}
          </span>
          <span className="block text-xs text-ink-muted">
            {documentTypeLabel(link.type)} · {date(link.issueDate)}
          </span>
        </span>
        {badge && link.lifecycle && (
          <DocBadges
            badges={[
              {
                key: link.lifecycle,
                tone: link.lifecycle === 'CANCELLED' ? 'danger' : 'info',
                labelKey: `status.${link.lifecycle.toLowerCase()}`,
              },
            ]}
          />
        )}
      </Link>
    </li>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  emphasis,
  small,
}: {
  label: string;
  value: string;
  strong?: boolean;
  emphasis?: boolean;
  small?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${small ? 'text-xs' : ''}`}>
      <span className={emphasis ? 'font-semibold text-ink' : 'text-ink-muted'}>{label}</span>
      <span
        className={
          emphasis
            ? 'tabular text-base font-semibold text-ink'
            : strong
              ? 'tabular font-medium text-ink'
              : 'tabular text-ink'
        }
      >
        {value}
      </span>
    </div>
  );
}
