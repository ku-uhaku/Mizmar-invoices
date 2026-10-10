'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { apiModules, ApiError, unwrap } from '@/lib/api';
import { Icon } from '@/components/icons';
import {
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
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { date, money } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';
import { useRole } from '@/lib/use-role';

export default function AdvancesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const { canSeePay } = useRole();
  const [creating, setCreating] = useState(false);

  const advances = useQuery({
    queryKey: ['payroll', 'advances'],
    enabled: canSeePay,
    queryFn: async () => unwrap(await apiModules.payroll.listAdvances({})),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await apiModules.payroll.removeAdvance({ params: { id } })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['payroll'] }),
    onError: (cause) => toast.error(cause instanceof ApiError ? cause.message : t('Suppression impossible')),
  });

  if (!canSeePay) return null;

  return (
    <>
      <PageHeader
        title={t('Avances sur salaire')}
        subtitle={t('Remboursées automatiquement sur les bulletins de paie')}
        actions={
          <>
            <Link href="/hr/payroll" className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink">
              {t('Retour à la paie')}
            </Link>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" className="size-4" />
              {t('Nouvelle avance')}
            </Button>
          </>
        }
      />
      <Card className="overflow-hidden">
        {advances.isPending ? (
          <TableSkeleton rows={4} cols={6} />
        ) : advances.data && advances.data.length > 0 ? (
          <Table className="min-w-[700px]">
            <thead>
              <tr>
                <Th>{t('Employé')}</Th>
                <Th>{t('Date')}</Th>
                <Th numeric>{t('Montant')}</Th>
                <Th numeric>{t('Remboursement mensuel')}</Th>
                <Th numeric>{t('Remboursé')}</Th>
                <Th numeric>{t('Reste')}</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {advances.data.map((advance) => (
                <tr key={advance.id}>
                  <Td className="font-medium">{advance.employeeName}</Td>
                  <Td className="text-ink-muted">{date(advance.date)}</Td>
                  <Td numeric>{money(advance.amount)}</Td>
                  <Td numeric className="text-ink-muted">{money(advance.monthlyRepayment)}</Td>
                  <Td numeric className="text-ink-muted">{money(advance.repaid)}</Td>
                  <Td numeric className="font-semibold">{money(advance.remaining)}</Td>
                  <Td>
                    {Number(advance.repaid) === 0 && (
                      <IconButton label={t('Supprimer')} onClick={() => remove.mutate(advance.id)} className="hover:bg-danger-soft hover:text-danger">
                        <Icon name="x" />
                      </IconButton>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon="wallet" title={t('Aucune avance')} />
        )}
      </Card>
      {creating && <AdvanceDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function AdvanceDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const employees = useQuery({
    queryKey: ['hr', 'employees', 'ACTIVE', '', ''],
    queryFn: async () => unwrap(await apiModules.hr.listEmployees({ query: { status: 'ACTIVE' } })),
  });
  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [monthly, setMonthly] = useState('');
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await apiModules.payroll.createAdvance({
          body: { employeeId, amount, date: day, monthlyRepayment: monthly, note: note || null },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payroll'] });
      onClose();
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Nouvelle avance')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!employeeId || !amount || !monthly} onClick={() => save.mutate()}>
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <Field label={t('Employé')} required>
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">{t('Choisir…')}</option>
            {employees.data?.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Montant')} required>
            <NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t('Remboursement mensuel')} required>
            <NumberInput value={monthly} onChange={(e) => setMonthly(e.target.value)} />
          </Field>
        </div>
        <Field label={t('Date')}>
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label={t('Note')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
