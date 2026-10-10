'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { amountToWords } from '@mizmar/i18n';
import { api, unwrap } from '@/lib/api';
import { date, documentTypeLabel, money, paymentMethodLabel } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/provider';
import { activeCompanyId } from '@/lib/session-client';
import { Button } from '@/components/ui';

/** A printable payment receipt (reçu): outside the app shell so only the slip prints. */
function Receipt() {
  const t = useT();
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const autoPrint = useSearchParams().get('print') === '1';
  const [companyId] = useState(() => activeCompanyId());

  const payment = useQuery({
    queryKey: ['payment', id],
    queryFn: async () => unwrap(await api.payments.get({ params: { id } })),
  });
  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => unwrap(await api.auth.me()),
    staleTime: 5 * 60_000,
  });
  const resolvedCompany = companyId ?? session.data?.companies[0]?.id ?? null;
  const company = useQuery({
    queryKey: ['company', resolvedCompany],
    queryFn: async () => unwrap(await api.companies.get({ params: { id: resolvedCompany! } })),
    enabled: Boolean(resolvedCompany),
  });

  const ready = Boolean(payment.data && company.data);
  useEffect(() => {
    if (autoPrint && ready) setTimeout(() => window.print(), 300);
  }, [autoPrint, ready]);

  if (payment.isError) {
    return <p className="p-8 text-center text-sm text-ink-muted">{t('Reçu introuvable')}</p>;
  }
  if (!payment.data || !company.data) {
    return <p className="p-8 text-center text-sm text-ink-muted">…</p>;
  }

  const p = payment.data;
  const c = company.data;
  const inbound = p.direction === 'INBOUND';
  const address = [c.addressLine1, [c.postalCode, c.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const legal = [c.ice && `ICE ${c.ice}`, c.taxId && `IF ${c.taxId}`, c.rc && `RC ${c.rc}`]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="min-h-screen bg-surface-muted py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-sm justify-end print:hidden">
        <Button variant="primary" onClick={() => window.print()}>
          {t('Imprimer')}
        </Button>
      </div>

      <article className="mx-auto w-full max-w-sm bg-white p-6 text-[13px] leading-relaxed text-black shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <header className="text-center">
          <h1 className="text-base font-bold">{c.name}</h1>
          {address && <p>{address}</p>}
          {c.phone && <p>{c.phone}</p>}
          {legal && <p className="text-[11px]">{legal}</p>}
        </header>

        <div className="my-4 border-y border-dashed border-black py-2 text-center">
          <p className="text-sm font-bold uppercase tracking-wide">
            {inbound ? t('Reçu de paiement') : t('Bon de décaissement')}
          </p>
          <p className="text-[11px]">
            N° {p.id.slice(-8).toUpperCase()} · {date(p.paidAt)}
          </p>
        </div>

        <dl className="space-y-1">
          <div className="flex justify-between gap-3">
            <dt>{inbound ? t('Reçu de') : t('Payé à')}</dt>
            <dd className="text-end font-medium">{p.contactName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{t('Mode')}</dt>
            <dd>{paymentMethodLabel(p.method)}</dd>
          </div>
          {p.reference && (
            <div className="flex justify-between gap-3">
              <dt>{t('Référence')}</dt>
              <dd>{p.reference}</dd>
            </div>
          )}
        </dl>

        {p.allocations.length > 0 && (
          <div className="mt-3 border-t border-dashed border-black pt-2">
            <p className="mb-1 text-[11px] font-semibold uppercase">{t('Règlement de')}</p>
            <ul className="space-y-0.5">
              {p.allocations.map((allocation) => (
                <li key={allocation.documentId} className="flex justify-between gap-3">
                  <span>
                    {documentTypeLabel(allocation.documentType)} {allocation.documentNumber ?? ''}
                  </span>
                  <span className="tabular-nums">{money(allocation.amount, p.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 flex items-baseline justify-between border-t border-dashed border-black pt-2 text-base font-bold">
          <span>{t('Montant')}</span>
          <span className="tabular-nums">{money(p.amount, p.currency)}</span>
        </div>
        <p className="mt-1 text-[11px] italic">
          {amountToWords(p.amount, locale, { currency: p.currency })}
        </p>

        {p.note && <p className="mt-2 text-[11px]">{p.note}</p>}

        <p className="mt-6 text-center text-[11px]">{t('Merci de votre confiance')}</p>
      </article>
    </div>
  );
}

export default function ReceiptPage() {
  return (
    <Suspense fallback={null}>
      <Receipt />
    </Suspense>
  );
}
