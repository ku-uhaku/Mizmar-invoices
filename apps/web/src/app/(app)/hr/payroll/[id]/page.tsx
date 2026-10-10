'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
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
  IconButton,
  Input,
  NumberInput,
  PageHeader,
  Select,
  StatCard,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { money, paymentMethodLabel } from '@/lib/format';
import { MONTHS, RUN_STATUS, type PayslipRow } from '@/lib/payroll';
import { useT } from '@/lib/i18n/provider';
import { useRole } from '@/lib/use-role';

const METHODS = ['BANK_TRANSFER', 'CASH', 'CHEQUE', 'OTHER'] as const;

export default function PayrollRunPage() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { canSeePay } = useRole();
  const [editing, setEditing] = useState<PayslipRow | null>(null);
  const [paying, setPaying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [skipped, setSkipped] = useState<Array<{ employeeName: string; reason: string }>>([]);

  const run = useQuery({
    queryKey: ['payroll', 'run', id],
    enabled: canSeePay,
    queryFn: async () => unwrap(await apiModules.payroll.getRun({ params: { id } })),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['payroll'] });
  const fail = (cause: unknown) =>
    toast.error(cause instanceof ApiError ? cause.message : t('Opération impossible'));

  const recompute = useMutation({
    mutationFn: async () => unwrap(await apiModules.payroll.recomputeRun({ params: { id }, body: {} })),
    onSuccess: (result) => {
      setSkipped(result.skipped);
      refresh();
      toast.success(t('Paie recalculée'));
    },
    onError: fail,
  });
  const validate = useMutation({
    mutationFn: async () => unwrap(await apiModules.payroll.validateRun({ params: { id }, body: {} })),
    onSuccess: () => {
      refresh();
      toast.success(t('Paie validée'));
    },
    onError: fail,
  });
  const reopen = useMutation({
    mutationFn: async () => unwrap(await apiModules.payroll.reopenRun({ params: { id }, body: {} })),
    onSuccess: refresh,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await apiModules.payroll.removeRun({ params: { id } })),
    onSuccess: () => {
      refresh();
      router.push('/hr/payroll');
    },
    onError: (cause) => {
      setRemoving(false);
      fail(cause);
    },
  });

  if (!canSeePay) return null;
  if (run.isPending) return <TableSkeleton rows={4} cols={6} />;
  if (run.isError) return <ErrorNote>{t('Chargement impossible')}</ErrorNote>;
  const r = run.data;
  const draft = r.status === 'DRAFT';
  const shownSkipped = skipped.length > 0 ? skipped : r.skipped;

  return (
    <>
      <PageHeader
        title={
          <>
            {t('Paie')} {t(MONTHS[r.month - 1]!)} {r.year}
            <Badge tone={RUN_STATUS[r.status].tone} className="ms-3 align-middle">
              {t(RUN_STATUS[r.status].label)}
            </Badge>
          </>
        }
        actions={
          <>
            <Link href="/hr/payroll" className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink">
              {t('Retour')}
            </Link>
            {draft && (
              <>
                <Button variant="ghost" onClick={() => setRemoving(true)}>
                  {t('Supprimer')}
                </Button>
                <Button variant="secondary" loading={recompute.isPending} onClick={() => recompute.mutate()}>
                  {t('Recalculer')}
                </Button>
                <Button variant="primary" loading={validate.isPending} disabled={r.payslipCount === 0} onClick={() => validate.mutate()}>
                  {t('Valider')}
                </Button>
              </>
            )}
            {r.status === 'VALIDATED' && (
              <>
                <Button variant="secondary" loading={reopen.isPending} onClick={() => reopen.mutate()}>
                  {t('Rouvrir')}
                </Button>
                <Button variant="primary" onClick={() => setPaying(true)}>
                  {t('Enregistrer le paiement')}
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('Total brut')} value={money(r.totalGross)} icon="invoice" />
        <StatCard label={t('Net à payer')} value={money(r.totalNet)} icon="wallet" tone="success" />
        <StatCard label={t('Coût employeur')} value={money(r.totalEmployerCost)} icon="trending" />
      </div>

      {shownSkipped.length > 0 && (
        <Card className="mb-4 border-warning/40 bg-warning-soft p-4 text-sm">
          <p className="mb-1 font-semibold text-warning">{t('Employés non inclus')}</p>
          <ul className="list-disc ps-5 text-ink">
            {shownSkipped.map((item) => (
              <li key={item.employeeName}>
                {item.employeeName} — {t(item.reason)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {r.status === 'PAID' && r.expenseId && (
        <Card className="mb-4 p-4 text-sm text-ink">
          {t('Le coût salarial a été enregistré en dépense : les charges sociales et l’IR restent à régler.')}{' '}
          <Link href="/expenses" className="font-medium text-brand hover:underline">
            {t('Voir les dépenses')}
          </Link>
        </Card>
      )}

      <Card className="overflow-hidden">
        {r.payslips.length > 0 ? (
          <Table className="min-w-[980px]">
            <thead>
              <tr>
                <Th>{t('Employé')}</Th>
                <Th numeric>{t('Base')}</Th>
                <Th numeric>{t('Brut')}</Th>
                <Th numeric>{t('CNSS')}</Th>
                <Th numeric>{t('AMO')}</Th>
                <Th numeric>{t('IR')}</Th>
                <Th numeric>{t('Avance')}</Th>
                <Th numeric>{t('Net')}</Th>
                <Th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {r.payslips.map((slip) => (
                <tr key={slip.id} className="hover:bg-surface-muted/60">
                  <Td>
                    <span className="font-medium">{slip.employeeName}</span>
                    <div className="text-xs text-ink-muted">
                      {slip.employeeNumber}
                      {Number(slip.unpaidDays) > 0 && ` · ${t('{n} j non payés', { n: slip.unpaidDays })}`}
                      {slip.overtimeMinutes > 0 && ` · ${t('{n} min sup.', { n: slip.overtimeMinutes })}`}
                    </div>
                  </Td>
                  <Td numeric className="text-ink-muted">{money(slip.baseSalary)}</Td>
                  <Td numeric>{money(slip.grossSalary)}</Td>
                  <Td numeric className="text-ink-muted">{money(slip.cnssEmployee)}</Td>
                  <Td numeric className="text-ink-muted">{money(slip.amoEmployee)}</Td>
                  <Td numeric className="text-ink-muted">{money(slip.incomeTax)}</Td>
                  <Td numeric className="text-ink-muted">{Number(slip.advanceDeduction) > 0 ? money(slip.advanceDeduction) : '—'}</Td>
                  <Td numeric className="font-semibold">{money(slip.netPay)}</Td>
                  <Td>
                    <span className="flex justify-end gap-1">
                      {draft && (
                        <IconButton label={t('Modifier')} onClick={() => setEditing(slip)}>
                          <Icon name="file" />
                        </IconButton>
                      )}
                      <a
                        href={`/payslip/${slip.id}`}
                        target="_blank"
                        rel="noreferrer"
                        title={t('Bulletin de paie')}
                        aria-label={t('Bulletin de paie')}
                        className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink"
                      >
                        <Icon name="printer" />
                      </a>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon="users" title={t('Aucun bulletin')} description={t('Aucun employé avec un contrat ce mois-là.')} />
        )}
      </Card>

      {editing && <PayslipDialog slip={editing} onClose={() => setEditing(null)} />}
      {paying && <PayDialog runId={id} onClose={() => setPaying(false)} />}
      {removing && (
        <Dialog
          open
          onClose={() => setRemoving(false)}
          title={t('Supprimer cette paie ?')}
          description={t('Tous les bulletins du brouillon seront supprimés.')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRemoving(false)}>
                {t('Annuler')}
              </Button>
              <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
                {t('Supprimer')}
              </Button>
            </>
          }
        >
          <></>
        </Dialog>
      )}
    </>
  );
}

interface ItemDraft {
  label: string;
  amount: string;
}

function PayslipDialog({ slip, onClose }: { slip: PayslipRow; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['payroll', 'payslip', slip.id],
    queryFn: async () => unwrap(await apiModules.payroll.getPayslip({ params: { id: slip.id } })),
  });
  const [unpaidDays, setUnpaidDays] = useState<string | null>(null);
  const [overtime, setOvertime] = useState<string | null>(null);
  const [additions, setAdditions] = useState<ItemDraft[] | null>(null);
  const [deductions, setDeductions] = useState<ItemDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = detail.data;
  const adds = additions ?? data?.additions ?? [];
  const deds = deductions ?? data?.deductions ?? [];

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      const clean = (items: ItemDraft[]) => items.filter((item) => item.label.trim() && item.amount !== '');
      return unwrap(
        await apiModules.payroll.updatePayslip({
          params: { id: slip.id },
          body: {
            unpaidDays: unpaidDays ?? data?.unpaidDays ?? '0',
            overtimeMinutes: Number(overtime ?? data?.overtimeMinutes ?? 0) || 0,
            additions: clean(adds),
            deductions: clean(deds),
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payroll'] });
      onClose();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  const list = (
    items: ItemDraft[],
    set: (items: ItemDraft[]) => void,
    title: string,
    hint: string,
  ) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{t(title)}</span>
        <Button variant="ghost" size="sm" onClick={() => set([...items, { label: '', amount: '' }])}>
          {t('Ajouter')}
        </Button>
      </div>
      <p className="text-xs text-ink-muted">{t(hint)}</p>
      {items.map((item, index) => (
        <div key={index} className="flex gap-2">
          <Input
            value={item.label}
            placeholder={t('Libellé')}
            onChange={(e) => set(items.map((it, i) => (i === index ? { ...it, label: e.target.value } : it)))}
          />
          <NumberInput
            value={item.amount}
            className="w-32"
            onChange={(e) => set(items.map((it, i) => (i === index ? { ...it, amount: e.target.value } : it)))}
          />
          <IconButton label={t('Supprimer')} onClick={() => set(items.filter((_, i) => i !== index))}>
            <Icon name="x" />
          </IconButton>
        </div>
      ))}
    </div>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      width="lg"
      title={slip.employeeName}
      description={t('Les montants sont recalculés à l’enregistrement.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!data} onClick={() => save.mutate()}>
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNote>{error}</ErrorNote>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Jours non payés')} hint={t('Congé sans solde et absences injustifiées')}>
            <NumberInput value={unpaidDays ?? data?.unpaidDays ?? ''} onChange={(e) => setUnpaidDays(e.target.value)} />
          </Field>
          <Field label={t('Heures supplémentaires (minutes)')}>
            <NumberInput value={overtime ?? String(data?.overtimeMinutes ?? '')} onChange={(e) => setOvertime(e.target.value)} />
          </Field>
        </div>
        {list(adds, setAdditions, 'Primes et indemnités', 'Imposables et soumises aux cotisations.')}
        {list(deds, setDeductions, 'Retenues', 'Retirées du net après impôt (amendes, prêts…).')}
        {data && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl bg-surface-muted p-3 text-sm">
            <span className="text-ink-muted">{t('Brut')}</span>
            <span className="tabular text-end">{money(data.grossSalary)}</span>
            <span className="text-ink-muted">{t('Net actuel')}</span>
            <span className="tabular text-end font-semibold">{money(data.netPay)}</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function PayDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<(typeof METHODS)[number]>('BANK_TRANSFER');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const pay = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(await apiModules.payroll.payRun({ params: { id: runId }, body: { method, paidAt } }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success(t('Paiement enregistré'));
      onClose();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Opération impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Enregistrer le paiement des salaires')}
      description={t('Les salaires nets sont marqués payés. Les cotisations CNSS, AMO et l’IR restent à régler dans les dépenses.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" loading={pay.isPending} onClick={() => pay.mutate()}>
            {t('Confirmer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <Field label={t('Moyen de paiement')}>
          <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {METHODS.map((value) => (
              <option key={value} value={value}>
                {paymentMethodLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('Date du paiement')}>
          <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
