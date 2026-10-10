'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiModules, unwrap } from '@/lib/api';
import { EmployeeDialog, useDepartments } from '@/components/employee-dialog';
import { Icon } from '@/components/icons';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  Table,
  TableSkeleton,
  Td,
  Th,
} from '@/components/ui';
import { date, money } from '@/lib/format';
import { label as labelOf, CONTRACT_TYPES } from '@/lib/hr';
import { useT } from '@/lib/i18n/provider';
import { useRole } from '@/lib/use-role';

type Filter = 'ACTIVE' | 'TERMINATED' | 'ALL';

export default function EmployeesPage() {
  const t = useT();
  const router = useRouter();
  const { canSeePay, canManageHr } = useRole();
  const [status, setStatus] = useState<Filter>('ACTIVE');
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [adding, setAdding] = useState(false);
  const departments = useDepartments();

  const list = useQuery({
    queryKey: ['hr', 'employees', status, search, departmentId],
    queryFn: async () =>
      unwrap(
        await apiModules.hr.listEmployees({
          query: {
            ...(status !== 'ALL' ? { status } : {}),
            ...(search.trim() ? { search: search.trim() } : {}),
            ...(departmentId ? { departmentId } : {}),
          },
        }),
      ),
  });

  return (
    <>
      <PageHeader
        title={t('Employés')}
        subtitle={list.data ? t('{n} employé(s)', { n: list.data.length }) : undefined}
        actions={
          canManageHr && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Icon name="plus" className="size-4" />
              {t('Nouvel employé')}
            </Button>
          )
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented<Filter>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'ACTIVE', label: t('En poste') },
            { value: 'TERMINATED', label: t('Sortis') },
            { value: 'ALL', label: t('Tous') },
          ]}
        />
        <div className="w-56">
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">{t('Tous les départements')}</option>
            {departments.data?.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-64">
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Rechercher…')} />
        </div>
      </div>

      <Card className="overflow-hidden">
        {list.isPending ? (
          <TableSkeleton rows={6} cols={6} />
        ) : list.isError ? (
          <ErrorNote>{t('Chargement impossible')}</ErrorNote>
        ) : list.data.length > 0 ? (
          <Table className="min-w-[820px]">
            <thead>
              <tr>
                <Th>{t('N°')}</Th>
                <Th>{t('Nom')}</Th>
                <Th>{t('Fonction')}</Th>
                <Th>{t('Département')}</Th>
                <Th>{t('Contrat')}</Th>
                <Th>{t('Embauche')}</Th>
                {canSeePay && <Th numeric>{t('Salaire brut')}</Th>}
              </tr>
            </thead>
            <tbody>
              {list.data.map((employee) => (
                <tr
                  key={employee.id}
                  onClick={() => router.push(`/hr/employees/${employee.id}`)}
                  className="cursor-pointer hover:bg-surface-muted/60"
                >
                  <Td className="text-ink-muted">{employee.employeeNumber}</Td>
                  <Td>
                    <span className="font-medium text-ink">{employee.fullName}</span>
                    {employee.status === 'TERMINATED' && (
                      <Badge className="ms-2">{t('Sorti')}</Badge>
                    )}
                  </Td>
                  <Td className="text-ink-muted">{employee.jobTitle ?? '—'}</Td>
                  <Td className="text-ink-muted">{employee.departmentName ?? '—'}</Td>
                  <Td className="text-ink-muted">
                    {employee.currentContract
                      ? t(labelOf(CONTRACT_TYPES, employee.currentContract.type)).split(' ')[0]
                      : '—'}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">{date(employee.hireDate)}</Td>
                  {canSeePay && (
                    <Td numeric>
                      {employee.currentContract?.baseSalary ? money(employee.currentContract.baseSalary) : '—'}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon="users"
            title={t('Aucun employé')}
            description={t('Ajoutez votre équipe pour suivre les congés et les présences.')}
          />
        )}
      </Card>

      {adding && (
        <EmployeeDialog
          canSetPay={canSeePay}
          onClose={() => setAdding(false)}
          onSaved={(employee) => router.push(`/hr/employees/${employee.id}`)}
        />
      )}
    </>
  );
}
