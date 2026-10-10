'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
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
  Input,
  NumberInput,
  PageHeader,
  Segmented,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { date } from '@/lib/format';
import { LEAVE_STATUS, type LeaveRequest } from '@/lib/hr';
import { useT } from '@/lib/i18n/provider';
import { useRole } from '@/lib/use-role';

type Tab = 'requests' | 'balances';
type Filter = 'ALL' | LeaveRequest['status'];

export default function LeavePage() {
  const t = useT();
  const queryClient = useQueryClient();
  const { canManageHr } = useRole();
  const [tab, setTab] = useState<Tab>('requests');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [creating, setCreating] = useState(false);
  const year = new Date().getFullYear();

  const requests = useQuery({
    queryKey: ['hr', 'leave', filter],
    queryFn: async () =>
      unwrap(await apiModules.hr.listLeave({ query: filter === 'ALL' ? {} : { status: filter } })),
  });
  const balances = useQuery({
    queryKey: ['hr', 'balances', year],
    enabled: tab === 'balances',
    queryFn: async () => unwrap(await apiModules.hr.leaveBalances({ query: { year } })),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['hr'] });
  const fail = (cause: unknown) =>
    toast.error(cause instanceof ApiError ? cause.message : t('Opération impossible'));

  const decide = useMutation({
    mutationFn: async (input: { id: string; approve: boolean }) =>
      unwrap(await apiModules.hr.decideLeave({ params: { id: input.id }, body: { approve: input.approve } })),
    onSuccess: refresh,
    onError: fail,
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => unwrap(await apiModules.hr.cancelLeave({ params: { id }, body: {} })),
    onSuccess: refresh,
    onError: fail,
  });

  return (
    <>
      <PageHeader
        title={t('Congés')}
        subtitle={t('Demandes, validation et soldes')}
        actions={
          canManageHr && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" className="size-4" />
              {t('Nouvelle demande')}
            </Button>
          )
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'requests', label: t('Demandes') },
            { value: 'balances', label: t('Soldes {year}', { year }) },
          ]}
        />
        {tab === 'requests' && (
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'ALL', label: t('Toutes') },
              { value: 'PENDING', label: t('En attente') },
              { value: 'APPROVED', label: t('Approuvé') },
              { value: 'REJECTED', label: t('Refusé') },
            ]}
          />
        )}
        <Link href="/settings/hr" className="ms-auto text-sm font-medium text-brand hover:underline">
          {t('Types de congé')}
        </Link>
      </div>

      <Card className="overflow-hidden">
        {tab === 'requests' ? (
          requests.isPending ? (
            <TableSkeleton rows={5} cols={6} />
          ) : requests.data && requests.data.length > 0 ? (
            <Table className="min-w-[760px]">
              <thead>
                <tr>
                  <Th>{t('Employé')}</Th>
                  <Th>{t('Type')}</Th>
                  <Th>{t('Période')}</Th>
                  <Th numeric>{t('Jours')}</Th>
                  <Th>{t('Statut')}</Th>
                  <Th className="w-48" />
                </tr>
              </thead>
              <tbody>
                {requests.data.map((request) => (
                  <tr key={request.id} className="hover:bg-surface-muted/60">
                    <Td>
                      <Link href={`/hr/employees/${request.employeeId}`} className="font-medium text-ink hover:text-brand">
                        {request.employeeName}
                      </Link>
                      {request.reason && <div className="text-xs text-ink-muted">{request.reason}</div>}
                    </Td>
                    <Td>
                      {t(request.typeName)}
                      {!request.isPaid && <Badge className="ms-2">{t('Sans solde')}</Badge>}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-muted">
                      {date(request.startDate)} → {date(request.endDate)}
                    </Td>
                    <Td numeric>{request.days}</Td>
                    <Td>
                      <Badge tone={LEAVE_STATUS[request.status].tone}>{t(LEAVE_STATUS[request.status].label)}</Badge>
                    </Td>
                    <Td>
                      {canManageHr && (
                        <span className="flex justify-end gap-1">
                          {request.status === 'PENDING' && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={decide.isPending}
                                onClick={() => decide.mutate({ id: request.id, approve: true })}
                              >
                                {t('Approuver')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={decide.isPending}
                                onClick={() => decide.mutate({ id: request.id, approve: false })}
                              >
                                {t('Refuser')}
                              </Button>
                            </>
                          )}
                          {(request.status === 'PENDING' || request.status === 'APPROVED') && (
                            <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(request.id)}>
                              {t('Annuler')}
                            </Button>
                          )}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState icon="clock" title={t('Aucune demande de congé')} />
          )
        ) : balances.isPending ? (
          <TableSkeleton rows={5} cols={6} />
        ) : balances.data && balances.data.length > 0 ? (
          <Table className="min-w-[640px]">
            <thead>
              <tr>
                <Th>{t('Employé')}</Th>
                <Th>{t('Type')}</Th>
                <Th numeric>{t('Droits')}</Th>
                <Th numeric>{t('Pris')}</Th>
                <Th numeric>{t('En attente')}</Th>
                <Th numeric>{t('Solde')}</Th>
              </tr>
            </thead>
            <tbody>
              {balances.data.map((row) => (
                <tr key={`${row.employeeId}-${row.typeId}`}>
                  <Td className="font-medium">{row.employeeName}</Td>
                  <Td className="text-ink-muted">{t(row.typeName)}</Td>
                  <Td numeric>{row.entitlement}</Td>
                  <Td numeric>{row.taken}</Td>
                  <Td numeric className="text-ink-muted">{row.pending}</Td>
                  <Td numeric className={Number(row.remaining) < 0 ? 'font-semibold text-danger' : 'font-semibold'}>
                    {row.remaining}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon="users" title={t('Aucun solde à afficher')} description={t('Ajoutez des employés et des types de congé avec un droit annuel.')} />
        )}
      </Card>

      {creating && <LeaveDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function LeaveDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const employees = useQuery({
    queryKey: ['hr', 'employees', 'ACTIVE', '', ''],
    queryFn: async () => unwrap(await apiModules.hr.listEmployees({ query: { status: 'ACTIVE' } })),
  });
  const types = useQuery({
    queryKey: ['hr', 'leave-types'],
    queryFn: async () => unwrap(await apiModules.hr.listLeaveTypes({})),
  });

  const today = new Date().toISOString().slice(0, 10);
  const [employeeId, setEmployeeId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      return unwrap(
        await apiModules.hr.createLeave({
          body: {
            employeeId,
            typeId,
            startDate,
            endDate,
            ...(days !== '' ? { days } : {}),
            reason: reason || null,
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hr'] });
      toast.success(t('Demande enregistrée'));
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
      title={t('Nouvelle demande de congé')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!employeeId || !typeId || endDate < startDate}
            onClick={() => save.mutate()}
          >
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
        <Field label={t('Type de congé')} required>
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">{t('Choisir…')}</option>
            {types.data
              ?.filter((type) => type.isActive)
              .map((type) => (
                <option key={type.id} value={type.id}>
                  {t(type.name)}
                </option>
              ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Du')}>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label={t('Au')}>
            <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <Field label={t('Nombre de jours')} hint={t('Vide : jours ouvrables (lundi à samedi)')}>
          <NumberInput value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Field label={t('Motif')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
