'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { amountToWords } from '@mizmar/i18n';
import { api, apiModules, unwrap } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/provider';
import { MONTHS } from '@/lib/payroll';
import { activeCompanyId } from '@/lib/session-client';
import { Button } from '@/components/ui';

/** A printable payslip (bulletin de paie): outside the app shell so only the page prints. */
function PayslipView() {
  const t = useT();
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const autoPrint = useSearchParams().get('print') === '1';
  const [companyId] = useState(() => activeCompanyId());

  const slip = useQuery({
    queryKey: ['payroll', 'payslip', id],
    queryFn: async () => unwrap(await apiModules.payroll.getPayslip({ params: { id } })),
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

  const ready = Boolean(slip.data && company.data);
  useEffect(() => {
    if (autoPrint && ready) setTimeout(() => window.print(), 300);
  }, [autoPrint, ready]);

  if (slip.isError) {
    return <p className="p-8 text-center text-sm text-ink-muted">{t('Bulletin introuvable')}</p>;
  }
  if (!slip.data || !company.data) {
    return <p className="p-8 text-center text-sm text-ink-muted">…</p>;
  }

  const s = slip.data;
  const c = company.data;
  const e = s.employee;
  const cur = c.defaultCurrency;
  const address = [c.addressLine1, [c.postalCode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const legal = [c.ice && `ICE ${c.ice}`, c.taxId && `IF ${c.taxId}`, c.rc && `RC ${c.rc}`, c.cnss && `CNSS ${c.cnss}`]
    .filter(Boolean)
    .join(' · ');

  // [label, gain, deduction]
  const lines: Array<[string, string | null, string | null]> = [
    [t('Salaire de base'), s.baseSalary, null],
    ...(Number(s.unpaidDeduction) > 0 ? ([[`${t('Jours non payés')} (${s.unpaidDays} ${t('j')})`, null, s.unpaidDeduction]] as Array<[string, null, string]>) : []),
    ...(Number(s.overtimePay) > 0 ? ([[`${t('Heures supplémentaires')} (${s.overtimeMinutes} min)`, s.overtimePay, null]] as Array<[string, string, null]>) : []),
    ...s.additions.map((item): [string, string, null] => [item.label, item.amount, null]),
    [t('CNSS (part salariale)'), null, s.cnssEmployee],
    [t('AMO (part salariale)'), null, s.amoEmployee],
    [t('Impôt sur le revenu (IR)'), null, s.incomeTax],
    ...s.deductions.map((item): [string, null, string] => [item.label, null, item.amount]),
    ...(Number(s.advanceDeduction) > 0 ? ([[t('Remboursement d’avance'), null, s.advanceDeduction]] as Array<[string, null, string]>) : []),
  ];

  return (
    <div className="min-h-screen bg-surface-muted py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-3xl justify-end print:hidden">
        <Button variant="primary" onClick={() => window.print()}>
          {t('Imprimer')}
        </Button>
      </div>

      <article className="mx-auto w-full max-w-3xl bg-white p-8 text-[13px] leading-relaxed text-black shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
          <div>
            <h1 className="text-lg font-bold">{c.name}</h1>
            {address && <p>{address}</p>}
            {legal && <p className="text-[11px]">{legal}</p>}
          </div>
          <div className="text-end">
            <p className="text-base font-bold uppercase tracking-wide">{t('Bulletin de paie')}</p>
            <p>
              {t(MONTHS[s.month - 1]!)} {s.year}
            </p>
          </div>
        </header>

        <section className="my-4 grid grid-cols-2 gap-x-8 gap-y-1">
          {(
            [
              [t('Employé'), e.fullName],
              [t('N° employé'), e.employeeNumber],
              [t('Fonction'), e.jobTitle],
              [t('Département'), e.departmentName],
              [t('CIN'), e.cin],
              [t('N° CNSS'), e.cnssNumber],
              [t('Date d’embauche'), date(e.hireDate)],
              [t('Personnes à charge'), String(e.dependents)],
            ] as Array<[string, string | null]>
          ).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-b border-dotted border-black/40">
              <span className="text-black/70">{label}</span>
              <span className="font-medium">{value || '—'}</span>
            </div>
          ))}
        </section>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-y border-black text-[11px] uppercase">
              <th className="py-1 text-start">{t('Rubrique')}</th>
              <th className="py-1 text-end">{t('Gains')}</th>
              <th className="py-1 text-end">{t('Retenues')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(([label, gain, deduction], index) => (
              <tr key={index} className="border-b border-black/10">
                <td className="py-1">{label}</td>
                <td className="py-1 text-end tabular-nums">{gain ? money(gain, cur) : ''}</td>
                <td className="py-1 text-end tabular-nums">{deduction ? money(deduction, cur) : ''}</td>
              </tr>
            ))}
            <tr className="border-y border-black font-semibold">
              <td className="py-1">{t('Salaire brut')}</td>
              <td className="py-1 text-end tabular-nums">{money(s.grossSalary, cur)}</td>
              <td />
            </tr>
          </tbody>
        </table>

        <div className="mt-3 flex items-baseline justify-between border-2 border-black px-3 py-2 text-base font-bold">
          <span>{t('Net à payer')}</span>
          <span className="tabular-nums">{money(s.netPay, cur)}</span>
        </div>
        <p className="mt-1 text-[11px] italic">{amountToWords(s.netPay, locale, { currency: cur })}</p>

        <section className="mt-4 grid grid-cols-2 gap-x-8 text-[11px] text-black/80">
          <div>
            <p className="mb-1 font-semibold uppercase">{t('Base de calcul')}</p>
            <p className="flex justify-between"><span>{t('Base CNSS (plafonnée)')}</span><span className="tabular-nums">{money(s.cnssBase, cur)}</span></p>
            <p className="flex justify-between"><span>{t('Frais professionnels')}</span><span className="tabular-nums">{money(s.professionalExpenses, cur)}</span></p>
            <p className="flex justify-between"><span>{t('Net imposable')}</span><span className="tabular-nums">{money(s.taxableNet, cur)}</span></p>
          </div>
          <div>
            <p className="mb-1 font-semibold uppercase">{t('Charges patronales')}</p>
            <p className="flex justify-between"><span>CNSS</span><span className="tabular-nums">{money(s.cnssEmployer, cur)}</span></p>
            <p className="flex justify-between"><span>{t('Allocations familiales')}</span><span className="tabular-nums">{money(s.familyAllowance, cur)}</span></p>
            <p className="flex justify-between"><span>{t('Taxe de formation professionnelle')}</span><span className="tabular-nums">{money(s.trainingTax, cur)}</span></p>
            <p className="flex justify-between"><span>AMO</span><span className="tabular-nums">{money(s.amoEmployer, cur)}</span></p>
            <p className="flex justify-between border-t border-black/30 font-semibold"><span>{t('Coût employeur')}</span><span className="tabular-nums">{money(s.employerCost, cur)}</span></p>
          </div>
        </section>

        {(e.bankName || e.rib) && (
          <p className="mt-4 text-[11px]">
            {t('Virement')} : {[e.bankName, e.rib].filter(Boolean).join(' · ')}
          </p>
        )}
        <p className="mt-6 text-[10px] text-black/60">
          {t('Bulletin à conserver sans limitation de durée.')}
        </p>
      </article>
    </div>
  );
}

export default function PayslipPage() {
  return (
    <Suspense fallback={null}>
      <PayslipView />
    </Suspense>
  );
}
