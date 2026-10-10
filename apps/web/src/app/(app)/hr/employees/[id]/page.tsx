'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { apiModules, ApiError, unwrap } from '@/lib/api';
import { EmployeeDialog } from '@/components/employee-dialog';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
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
import { CONTRACT_TYPES, label as labelOf, LEAVE_STATUS, MARITAL } from '@/lib/hr';
import { useT } from '@/lib/i18n/provider';
import { useRole } from '@/lib/use-role';

export default function EmployeePage() {
  const t = useT();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { canSeePay, canManageHr } = useRole();
  const [editing, setEditing] = useState(false);
  const [contracting, setContracting] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const employee = useQuery({
    queryKey: ['hr', 'employee', id],
    queryFn: async () => unwrap(await apiModules.hr.getEmployee({ params: { id } })),
  });
  const contracts = useQuery({
    queryKey: ['hr', 'contracts', id],
    queryFn: async () => unwrap(await apiModules.hr.listContracts({ params: { id } })),
  });
  const leave = useQuery({
    queryKey: ['hr', 'leave', 'employee', id],
    queryFn: async () => unwrap(await apiModules.hr.listLeave({ query: { employeeId: id } })),
  });

  const terminate = useMutation({
    mutationFn: async () =>
      unwrap(await apiModules.hr.updateEmployee({ params: { id }, body: { status: 'TERMINATED' } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hr'] });
      toast.success(t('Départ enregistré'));
      setLeaving(false);
    },
    onError: (cause) => {
      setLeaving(false);
      toast.error(cause instanceof ApiError ? cause.message : t('Opération impossible'));
    },
  });

  if (employee.isPending) return <TableSkeleton rows={4} cols={3} />;
  if (employee.isError) return <ErrorNote>{t('Chargement impossible')}</ErrorNote>;
  const e = employee.data;

  const info: Array<[string, string | null]> = [
    ['N° employé', e.employeeNumber],
    ['Fonction', e.jobTitle],
    ['Département', e.departmentName],
    ['Date d’embauche', date(e.hireDate)],
    ...(e.terminationDate ? ([['Date de sortie', date(e.terminationDate)]] as Array<[string, string]>) : []),
    ['Date de naissance', e.birthDate ? date(e.birthDate) : null],
    ['CIN', e.cin],
    ['N° CNSS', e.cnssNumber],
    ['Téléphone', e.phone],
    ['E-mail', e.email],
    ['Situation familiale', t(labelOf(MARITAL, e.maritalStatus))],
    ['Personnes à charge', String(e.dependents)],
    ...(canSeePay
      ? ([
          ['Banque', e.bankName],
          ['RIB', e.rib],
        ] as Array<[string, string | null]>)
      : []),
  ];

  return (
    <>
      <PageHeader
        title={
          <>
            {e.fullName}
            {e.status === 'TERMINATED' && <Badge className="ms-3 align-middle">{t('Sorti')}</Badge>}
          </>
        }
        subtitle={[e.jobTitle, e.departmentName].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            <Link
              href="/hr/employees"
              className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              {t('Retour')}
            </Link>
            {canManageHr && (
              <>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  {t('Modifier')}
                </Button>
                {e.status === 'ACTIVE' && (
                  <Button variant="danger" onClick={() => setLeaving(true)}>
                    {t('Enregistrer le départ')}
                  </Button>
                )}
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card className="p-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {info.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-ink-muted">{t(key)}</dt>
                <dd className="text-ink">{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3">
              <h2 className="text-sm font-semibold text-ink">{t('Contrats')}</h2>
              {canManageHr && canSeePay && e.status === 'ACTIVE' && (
                <Button variant="secondary" size="sm" onClick={() => setContracting(true)}>
                  {t('Nouveau contrat')}
                </Button>
              )}
            </div>
            {contracts.data && contracts.data.length > 0 ? (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('Type')}</Th>
                    <Th>{t('Début')}</Th>
                    <Th>{t('Fin')}</Th>
                    {canSeePay && <Th numeric>{t('Salaire brut')}</Th>}
                  </tr>
                </thead>
                <tbody>
                  {contracts.data.map((contract) => (
                    <tr key={contract.id}>
                      <Td>
                        {t(labelOf(CONTRACT_TYPES, contract.type))}
                        {contract.isCurrent && <Badge tone="success" className="ms-2">{t('En cours')}</Badge>}
                      </Td>
                      <Td className="text-ink-muted">{date(contract.startDate)}</Td>
                      <Td className="text-ink-muted">{contract.endDate ? date(contract.endDate) : '—'}</Td>
                      {canSeePay && (
                        <Td numeric>{contract.baseSalary ? money(contract.baseSalary) : '—'}</Td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState icon="file" title={t('Aucun contrat')} />
            )}
          </Card>

          <Card className="overflow-hidden">
            <h2 className="px-5 py-3 text-sm font-semibold text-ink">{t('Congés')}</h2>
            {leave.data && leave.data.length > 0 ? (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('Type')}</Th>
                    <Th>{t('Période')}</Th>
                    <Th numeric>{t('Jours')}</Th>
                    <Th>{t('Statut')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {leave.data.map((request) => (
                    <tr key={request.id}>
                      <Td>{t(request.typeName)}</Td>
                      <Td className="whitespace-nowrap text-ink-muted">
                        {date(request.startDate)} → {date(request.endDate)}
                      </Td>
                      <Td numeric>{request.days}</Td>
                      <Td>
                        <Badge tone={LEAVE_STATUS[request.status].tone}>
                          {t(LEAVE_STATUS[request.status].label)}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState icon="clock" title={t('Aucun congé')} />
            )}
          </Card>
        </div>
      </div>

      {editing && <EmployeeDialog employee={e} canSetPay={canSeePay} onClose={() => setEditing(false)} />}
      {contracting && <ContractDialog employeeId={id} onClose={() => setContracting(false)} />}
      {leaving && (
        <Dialog
          open
          onClose={() => setLeaving(false)}
          title={t('Enregistrer le départ de {name} ?', { name: e.fullName })}
          description={t('Le contrat en cours prend fin aujourd’hui. L’historique est conservé.')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setLeaving(false)}>
                {t('Annuler')}
              </Button>
              <Button variant="danger" loading={terminate.isPending} onClick={() => terminate.mutate()}>
                {t('Confirmer')}
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

function ContractDialog({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [type, setType] = useState<(typeof CONTRACT_TYPES)[number][0]>('CDI');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [salary, setSalary] = useState('');
  const [hours, setHours] = useState('44');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await apiModules.hr.createContract({
          params: { id: employeeId },
          body: {
            type,
            startDate,
            endDate: endDate || null,
            baseSalary: salary,
            salaryPeriod: 'MONTHLY',
            weeklyHours: hours,
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hr'] });
      toast.success(t('Contrat enregistré'));
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title={t('Nouveau contrat')}
      description={t('Le contrat en cours est clôturé la veille de la date de début.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={salary === ''} onClick={() => save.mutate()}>
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <Field label={t('Type de contrat')}>
          <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {CONTRACT_TYPES.map(([value, text]) => (
              <option key={value} value={value}>
                {t(text)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Début')}>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label={t('Fin')} hint={t('Vide pour un CDI')}>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label={t('Salaire mensuel brut')} required>
            <NumberInput value={salary} onChange={(e) => setSalary(e.target.value)} />
          </Field>
          <Field label={t('Heures par semaine')}>
            <NumberInput value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
