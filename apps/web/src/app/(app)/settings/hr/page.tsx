'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiModules, ApiError, unwrap } from '@/lib/api';
import { useDepartments } from '@/components/employee-dialog';
import { Icon } from '@/components/icons';
import {
  Button,
  Card,
  Checkbox,
  Field,
  IconButton,
  Input,
  NumberInput,
  PageHeader,
  Table,
  Td,
  Th,
  toast,
} from '@/components/ui';
import { useT } from '@/lib/i18n/provider';
import { useRole } from '@/lib/use-role';

export default function HrSettingsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const { canManageHr } = useRole();
  const departments = useDepartments();
  const types = useQuery({
    queryKey: ['hr', 'leave-types'],
    queryFn: async () => unwrap(await apiModules.hr.listLeaveTypes({})),
  });
  const [department, setDepartment] = useState('');
  const [typeName, setTypeName] = useState('');
  const [typeDays, setTypeDays] = useState('0');
  const [typePaid, setTypePaid] = useState(true);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['hr'] });
  const fail = (cause: unknown) =>
    toast.error(cause instanceof ApiError ? cause.message : t('Enregistrement impossible'));

  const addDepartment = useMutation({
    mutationFn: async () => unwrap(await apiModules.hr.createDepartment({ body: { name: department.trim() } })),
    onSuccess: () => {
      setDepartment('');
      refresh();
    },
    onError: fail,
  });
  const removeDepartment = useMutation({
    mutationFn: async (id: string) => unwrap(await apiModules.hr.removeDepartment({ params: { id } })),
    onSuccess: refresh,
    onError: fail,
  });
  const addType = useMutation({
    mutationFn: async () =>
      unwrap(
        await apiModules.hr.createLeaveType({
          body: { name: typeName.trim(), isPaid: typePaid, daysPerYear: typeDays || '0', isActive: true },
        }),
      ),
    onSuccess: () => {
      setTypeName('');
      setTypeDays('0');
      refresh();
    },
    onError: fail,
  });
  const updateType = useMutation({
    mutationFn: async (input: { id: string; body: { isPaid?: boolean; isActive?: boolean; daysPerYear?: string } }) =>
      unwrap(await apiModules.hr.updateLeaveType({ params: { id: input.id }, body: input.body })),
    onSuccess: refresh,
    onError: fail,
  });

  return (
    <>
      <PageHeader title={t('Paramètres RH')} subtitle={t('Départements et types de congé')} />

      <Card className="mb-5 overflow-hidden">
        <h2 className="px-5 py-3 text-sm font-semibold text-ink">{t('Départements')}</h2>
        {canManageHr && (
          <div className="flex items-end gap-3 px-5 pb-4">
            <Field label={t('Nom')} className="flex-1">
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} />
            </Field>
            <Button variant="primary" loading={addDepartment.isPending} disabled={!department.trim()} onClick={() => addDepartment.mutate()}>
              {t('Ajouter')}
            </Button>
          </div>
        )}
        <Table>
          <tbody>
            {departments.data?.map((item) => (
              <tr key={item.id}>
                <Td className="font-medium">{item.name}</Td>
                <Td numeric className="text-ink-muted">{t('{n} employé(s)', { n: item.employeeCount })}</Td>
                <Td className="w-10">
                  {canManageHr && (
                    <IconButton label={t('Supprimer')} onClick={() => removeDepartment.mutate(item.id)} className="hover:bg-danger-soft hover:text-danger">
                      <Icon name="x" />
                    </IconButton>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="overflow-hidden">
        <h2 className="px-5 py-3 text-sm font-semibold text-ink">{t('Types de congé')}</h2>
        {canManageHr && (
          <div className="grid gap-3 px-5 pb-4 sm:grid-cols-[1fr_9rem_auto_auto] sm:items-end">
            <Field label={t('Nom')}>
              <Input value={typeName} onChange={(e) => setTypeName(e.target.value)} />
            </Field>
            <Field label={t('Jours par an')}>
              <NumberInput value={typeDays} onChange={(e) => setTypeDays(e.target.value)} />
            </Field>
            <Checkbox label={t('Payé')} checked={typePaid} onChange={(e) => setTypePaid(e.target.checked)} />
            <Button variant="primary" loading={addType.isPending} disabled={!typeName.trim()} onClick={() => addType.mutate()}>
              {t('Ajouter')}
            </Button>
          </div>
        )}
        <Table>
          <thead>
            <tr>
              <Th>{t('Nom')}</Th>
              <Th numeric>{t('Jours par an')}</Th>
              <Th>{t('Payé')}</Th>
              <Th>{t('Actif')}</Th>
            </tr>
          </thead>
          <tbody>
            {types.data?.map((type) => (
              <tr key={type.id}>
                <Td className="font-medium">{t(type.name)}</Td>
                <Td numeric>
                  <NumberInput
                    key={type.daysPerYear}
                    defaultValue={type.daysPerYear}
                    disabled={!canManageHr}
                    className="w-24"
                    onBlur={(e) => {
                      if (e.target.value !== type.daysPerYear && e.target.value !== '') {
                        updateType.mutate({ id: type.id, body: { daysPerYear: e.target.value } });
                      }
                    }}
                  />
                </Td>
                <Td>
                  <Checkbox label="" checked={type.isPaid} disabled={!canManageHr} onChange={(e) => updateType.mutate({ id: type.id, body: { isPaid: e.target.checked } })} />
                </Td>
                <Td>
                  <Checkbox label="" checked={type.isActive} disabled={!canManageHr} onChange={(e) => updateType.mutate({ id: type.id, body: { isActive: e.target.checked } })} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="px-5 py-3 text-xs text-ink-muted">
          {t('Les droits par défaut suivent le Code du travail (1,5 jour par mois). Ajustez-les selon votre convention.')}
        </p>
      </Card>
    </>
  );
}
