'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiModules, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  NumberInput,
  PageHeader,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { money } from '@/lib/format';
import { MONTHS, RUN_STATUS } from '@/lib/payroll';
import { useT } from '@/lib/i18n/provider';
import { useRole } from '@/lib/use-role';

export default function PayrollPage() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { canSeePay } = useRole();
  const now = new Date();
  const [creating, setCreating] = useState(false);
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [error, setError] = useState<string | null>(null);

  const runs = useQuery({
    queryKey: ['payroll', 'runs'],
    enabled: canSeePay,
    queryFn: async () => unwrap(await apiModules.payroll.listRuns({})),
  });

  const create = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await apiModules.payroll.createRun({ body: { year: Number(year), month: Number(month) } }),
      );
    },
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ['payroll'] });
      toast.success(t('Paie créée'));
      router.push(`/hr/payroll/${run.id}`);
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Création impossible')),
  });

  if (!canSeePay) {
    return (
      <Card>
        <EmptyState icon="alert" title={t('Accès réservé')} description={t('La paie est réservée aux propriétaires, administrateurs et comptables.')} />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title={t('Paie')}
        subtitle={t('Bulletins de paie mensuels, CNSS, AMO et IR')}
        actions={
          <>
            <Link href="/hr/advances" className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink">
              {t('Avances sur salaire')}
            </Link>
            <Link href="/settings/payroll" className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink">
              {t('Taux et barème')}
            </Link>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" className="size-4" />
              {t('Nouvelle paie')}
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        {runs.isPending ? (
          <TableSkeleton rows={4} cols={6} />
        ) : runs.data && runs.data.length > 0 ? (
          <Table className="min-w-[720px]">
            <thead>
              <tr>
                <Th>{t('Mois')}</Th>
                <Th>{t('Statut')}</Th>
                <Th numeric>{t('Bulletins')}</Th>
                <Th numeric>{t('Total brut')}</Th>
                <Th numeric>{t('Net à payer')}</Th>
                <Th numeric>{t('Coût employeur')}</Th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((run) => (
                <tr
                  key={run.id}
                  className="cursor-pointer hover:bg-surface-muted/60"
                  onClick={() => router.push(`/hr/payroll/${run.id}`)}
                >
                  <Td className="font-medium">
                    {t(MONTHS[run.month - 1]!)} {run.year}
                  </Td>
                  <Td>
                    <Badge tone={RUN_STATUS[run.status].tone}>{t(RUN_STATUS[run.status].label)}</Badge>
                  </Td>
                  <Td numeric>{run.payslipCount}</Td>
                  <Td numeric>{money(run.totalGross)}</Td>
                  <Td numeric className="font-semibold">{money(run.totalNet)}</Td>
                  <Td numeric>{money(run.totalEmployerCost)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon="wallet" title={t('Aucune paie')} description={t('Créez la paie d’un mois pour générer les bulletins de tous vos employés.')} />
        )}
      </Card>

      {creating && (
        <Dialog
          open
          onClose={() => setCreating(false)}
          width="sm"
          title={t('Nouvelle paie')}
          description={t('Les bulletins sont calculés à partir des contrats, congés sans solde, absences et heures supplémentaires.')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setCreating(false)}>
                {t('Annuler')}
              </Button>
              <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
                {t('Calculer')}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <ErrorNote>{error}</ErrorNote>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Mois')}>
                <Select value={month} onChange={(e) => setMonth(e.target.value)}>
                  {MONTHS.map((name, index) => (
                    <option key={name} value={index + 1}>
                      {t(name)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('Année')}>
                <NumberInput value={year} onChange={(e) => setYear(e.target.value)} />
              </Field>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
