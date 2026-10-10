'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiModules, ApiError, unwrap } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, NumberInput, PageHeader, toast } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';
import type { PayrollRules } from '@/lib/payroll';
import { useRole } from '@/lib/use-role';

type Scalar =
  | 'cnssEmployeeRate' | 'cnssEmployerRate' | 'cnssCeiling' | 'amoEmployeeRate' | 'amoEmployerRate'
  | 'familyAllowanceEmployerRate' | 'trainingTaxEmployerRate' | 'otherEmployerRate'
  | 'familyDeductionAnnual' | 'maxDependents' | 'workingDaysPerMonth' | 'overtimeMultiplier';

const SCALARS: Array<[Scalar, string, string]> = [
  ['cnssEmployeeRate', 'CNSS — part salariale (%)', 'Prestations sociales, base plafonnée'],
  ['cnssEmployerRate', 'CNSS — part patronale (%)', 'Prestations sociales, base plafonnée'],
  ['cnssCeiling', 'Plafond CNSS mensuel', ''],
  ['amoEmployeeRate', 'AMO — part salariale (%)', 'Sans plafond'],
  ['amoEmployerRate', 'AMO — part patronale (%)', 'Sans plafond'],
  ['familyAllowanceEmployerRate', 'Allocations familiales (%)', 'Patronal, sans plafond'],
  ['trainingTaxEmployerRate', 'Taxe de formation professionnelle (%)', 'Patronal, sans plafond'],
  ['otherEmployerRate', 'Autre cotisation patronale (%)', 'Optionnelle'],
  ['familyDeductionAnnual', 'Déduction annuelle par personne à charge', 'Sur l’IR calculé'],
  ['maxDependents', 'Personnes à charge maximum', ''],
  ['workingDaysPerMonth', 'Jours de paie par mois', 'Sert à valoriser un jour non payé'],
  ['overtimeMultiplier', 'Majoration des heures supplémentaires', '1,25 = +25 %'],
];

export default function PayrollSettingsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const { canSeePay } = useRole();
  const current = useQuery({
    queryKey: ['payroll', 'rules'],
    enabled: canSeePay,
    queryFn: async () => unwrap(await apiModules.payroll.getRules({})),
  });
  const [rules, setRules] = useState<PayrollRules | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (current.data) setRules(structuredClone(current.data.rules));
  }, [current.data]);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(await apiModules.payroll.saveRules({ body: { effectiveFrom, rules: rules! } }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payroll'] });
      toast.success(t('Barème enregistré'));
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  if (!canSeePay) {
    return (
      <Card>
        <EmptyState icon="alert" title={t('Accès réservé')} />
      </Card>
    );
  }
  if (!rules) return null;

  const set = <K extends keyof PayrollRules>(key: K, value: PayrollRules[K]) => setRules({ ...rules, [key]: value });
  const num = (value: string) => (value === '' ? 0 : Number(value.replace(',', '.')));

  return (
    <>
      <PageHeader
        title={t('Taux et barème de paie')}
        subtitle={t('Cotisations sociales et impôt sur le revenu, modifiables à chaque loi de finances')}
        actions={
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {t('Enregistrer')}
          </Button>
        }
      />

      <Card className="mb-4 border-warning/40 bg-warning-soft p-4 text-sm text-ink">
        {t('Valeurs par défaut : barème IR de la loi de finances 2025 et taux CNSS/AMO 2025-2026. Les frais professionnels (35 % jusqu’à 6 500 DH par mois, 25 % au-delà, plafonnés) sont à confirmer avec votre comptable ou la DGI avant la première paie.')}
      </Card>

      <ErrorNote>{error}</ErrorNote>

      <Card className="mb-4 p-5">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-sm font-semibold text-ink">{t('Cotisations et paramètres')}</h2>
          <Badge tone={current.data?.source === 'custom' ? 'success' : 'neutral'}>
            {current.data?.source === 'custom' ? t('Personnalisé') : t('Valeurs par défaut')}
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SCALARS.map(([key, label, hint]) => (
            <Field key={key} label={t(label)} hint={hint ? t(hint) : undefined}>
              <NumberInput value={String(rules[key])} onChange={(e) => set(key, num(e.target.value))} />
            </Field>
          ))}
        </div>
      </Card>

      <Card className="mb-4 p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink">{t('Frais professionnels')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('Taux jusqu’au seuil (%)')}>
            <NumberInput value={String(rules.professionalExpenses.lowRate)} onChange={(e) => set('professionalExpenses', { ...rules.professionalExpenses, lowRate: num(e.target.value) })} />
          </Field>
          <Field label={t('Taux au-delà (%)')}>
            <NumberInput value={String(rules.professionalExpenses.highRate)} onChange={(e) => set('professionalExpenses', { ...rules.professionalExpenses, highRate: num(e.target.value) })} />
          </Field>
          <Field label={t('Seuil mensuel')}>
            <NumberInput value={String(rules.professionalExpenses.monthlyThreshold)} onChange={(e) => set('professionalExpenses', { ...rules.professionalExpenses, monthlyThreshold: num(e.target.value) })} />
          </Field>
          <Field label={t('Plafond mensuel')}>
            <NumberInput value={String(rules.professionalExpenses.monthlyCap)} onChange={(e) => set('professionalExpenses', { ...rules.professionalExpenses, monthlyCap: num(e.target.value) })} />
          </Field>
        </div>
      </Card>

      <Card className="mb-4 p-5">
        <h2 className="mb-1 text-sm font-semibold text-ink">{t('Barème annuel de l’IR')}</h2>
        <p className="mb-4 text-xs text-ink-muted">{t('Revenu net imposable annuel. Laissez « jusqu’à » vide pour la dernière tranche.')}</p>
        <div className="space-y-2">
          {rules.irBrackets.map((bracket, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-3">
              <Field label={index === 0 ? t('Jusqu’à (DH)') : undefined}>
                <NumberInput
                  value={bracket.upTo === null ? '' : String(bracket.upTo)}
                  placeholder="∞"
                  onChange={(e) =>
                    set('irBrackets', rules.irBrackets.map((b, i) => (i === index ? { ...b, upTo: e.target.value === '' ? null : num(e.target.value) } : b)))
                  }
                />
              </Field>
              <Field label={index === 0 ? t('Taux (%)') : undefined}>
                <NumberInput value={String(bracket.rate)} onChange={(e) => set('irBrackets', rules.irBrackets.map((b, i) => (i === index ? { ...b, rate: num(e.target.value) } : b)))} />
              </Field>
              <Field label={index === 0 ? t('Somme à déduire') : undefined}>
                <NumberInput value={String(bracket.deduct)} onChange={(e) => set('irBrackets', rules.irBrackets.map((b, i) => (i === index ? { ...b, deduct: num(e.target.value) } : b)))} />
              </Field>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <Field label={t('Applicable à partir du')} hint={t('Les paies des mois suivants utilisent ces valeurs ; les bulletins validés ne changent pas.')} className="max-w-xs">
          <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
      </Card>
    </>
  );
}
