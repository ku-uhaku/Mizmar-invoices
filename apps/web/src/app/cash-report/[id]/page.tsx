'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, apiModules, unwrap } from '@/lib/api';
import { REASONS } from '@/components/cash-dialogs';
import { Button } from '@/components/ui';
import { dateTime, money, paymentMethodLabel } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { activeCompanyId } from '@/lib/session-client';

/** The Z ticket: outside the app shell so only the slip prints. */
function CashReport() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const autoPrint = useSearchParams().get('print') === '1';
  const [companyId] = useState(() => activeCompanyId());

  const session = useQuery({
    queryKey: ['cash', 'session', id],
    queryFn: async () => unwrap(await apiModules.cash.getSession({ params: { id } })),
  });
  const me = useQuery({
    queryKey: ['session'],
    queryFn: async () => unwrap(await api.auth.me()),
    staleTime: 5 * 60_000,
  });
  const resolved = companyId ?? me.data?.companies[0]?.id ?? null;
  const company = useQuery({
    queryKey: ['company', resolved],
    queryFn: async () => unwrap(await api.companies.get({ params: { id: resolved! } })),
    enabled: Boolean(resolved),
  });

  const ready = Boolean(session.data && company.data);
  useEffect(() => {
    if (autoPrint && ready) setTimeout(() => window.print(), 300);
  }, [autoPrint, ready]);

  if (session.isError) return <p className="p-8 text-center text-sm text-ink-muted">{t('Rapport introuvable')}</p>;
  if (!session.data || !company.data) return <p className="p-8 text-center text-sm text-ink-muted">…</p>;

  const s = session.data;
  const cur = s.currency;
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-3 ${strong ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface-muted py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-sm justify-end print:hidden">
        <Button variant="primary" onClick={() => window.print()}>
          {t('Imprimer')}
        </Button>
      </div>
      <article className="mx-auto w-full max-w-sm bg-white p-6 text-[13px] leading-relaxed text-black shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <header className="text-center">
          <h1 className="text-base font-bold">{company.data.name}</h1>
          <p className="text-sm font-bold uppercase tracking-wide">{t('Rapport Z')}</p>
          <p className="text-[11px]">
            {s.registerName} · {t('Session {n}', { n: s.number })}
          </p>
        </header>

        <div className="my-3 space-y-0.5 border-y border-dashed border-black py-2 text-[11px]">
          {row(t('Ouverture'), dateTime(s.openedAt))}
          <p className="text-end">{s.openedByName}</p>
          {s.closedAt && (
            <>
              {row(t('Clôture'), dateTime(s.closedAt))}
              <p className="text-end">{s.closedByName}</p>
            </>
          )}
        </div>

        <p className="mb-1 text-[11px] font-semibold uppercase">{t('Ventes')}</p>
        {s.byMethod.map((m) => row(`${paymentMethodLabel(m.method)} (${m.count})`, money(m.amount, cur)))}
        <div className="mt-1 border-t border-dashed border-black pt-1">
          {row(`${t('Total')} (${s.salesCount})`, money(s.salesTotal, cur), true)}
        </div>

        <p className="mb-1 mt-3 text-[11px] font-semibold uppercase">{t('Espèces')}</p>
        {row(t('Fonds de caisse'), money(s.openingFloat, cur))}
        {row(t('Ventes en espèces'), `+ ${money(s.cashSales, cur)}`)}
        {s.movements.map((m) =>
          row(
            `${m.type === 'IN' ? '+' : '−'} ${t(REASONS.find(([v]) => v === m.reason)?.[1] ?? m.reason)}${m.note ? ` (${m.note})` : ''}`,
            money(m.amount, cur),
          ),
        )}
        <div className="mt-1 border-t border-dashed border-black pt-1">
          {row(t('Espèces attendues'), money(s.expectedCash, cur), true)}
          {s.countedCash && row(t('Espèces comptées'), money(s.countedCash, cur))}
          {s.difference && row(t('Écart'), money(s.difference, cur), true)}
        </div>

        {s.closingNote && <p className="mt-2 text-[11px] italic">{s.closingNote}</p>}

        <div className="mt-8 grid grid-cols-2 gap-6 text-center text-[11px]">
          <div className="border-t border-black pt-1">{t('Caissier')}</div>
          <div className="border-t border-black pt-1">{t('Responsable')}</div>
        </div>
      </article>
    </div>
  );
}

export default function CashReportPage() {
  return (
    <Suspense fallback={null}>
      <CashReport />
    </Suspense>
  );
}
