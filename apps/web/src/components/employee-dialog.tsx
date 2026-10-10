'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiModules, ApiError, unwrap } from '@/lib/api';
import { CONTRACT_TYPES, MARITAL, type Employee } from '@/lib/hr';
import { useT } from '@/lib/i18n/provider';
import { Button, Dialog, ErrorNote, Field, Input, NumberInput, Select, toast } from './ui';

export function useDepartments() {
  return useQuery({
    queryKey: ['hr', 'departments'],
    queryFn: async () => unwrap(await apiModules.hr.listDepartments({})),
  });
}

const today = () => new Date().toISOString().slice(0, 10);

/** Create an employee (with a first contract when the caller may set pay) or edit one. */
export function EmployeeDialog({
  employee,
  canSetPay,
  onClose,
  onSaved,
}: {
  employee?: Employee;
  canSetPay: boolean;
  onClose: () => void;
  onSaved?: (employee: Employee) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const departments = useDepartments();

  const [firstName, setFirstName] = useState(employee?.firstName ?? '');
  const [lastName, setLastName] = useState(employee?.lastName ?? '');
  const [cin, setCin] = useState(employee?.cin ?? '');
  const [cnss, setCnss] = useState(employee?.cnssNumber ?? '');
  const [birthDate, setBirthDate] = useState(employee?.birthDate ?? '');
  const [hireDate, setHireDate] = useState(employee?.hireDate ?? today());
  const [jobTitle, setJobTitle] = useState(employee?.jobTitle ?? '');
  const [departmentId, setDepartmentId] = useState(employee?.departmentId ?? '');
  const [phone, setPhone] = useState(employee?.phone ?? '');
  const [email, setEmail] = useState(employee?.email ?? '');
  const [bankName, setBankName] = useState(employee?.bankName ?? '');
  const [rib, setRib] = useState(employee?.rib ?? '');
  const [marital, setMarital] = useState<Employee['maritalStatus']>(employee?.maritalStatus ?? 'SINGLE');
  const [dependents, setDependents] = useState(String(employee?.dependents ?? 0));
  const [contractType, setContractType] = useState<(typeof CONTRACT_TYPES)[number][0]>('CDI');
  const [salary, setSalary] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      const body = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        cin: cin || null,
        cnssNumber: cnss || null,
        birthDate: birthDate || null,
        hireDate,
        jobTitle: jobTitle || null,
        departmentId: departmentId || null,
        phone: phone || null,
        email: email || null,
        bankName: bankName || null,
        ...(canSetPay ? { rib: rib || null } : {}),
        maritalStatus: marital,
        dependents: Number(dependents) || 0,
      };
      return employee
        ? unwrap(await apiModules.hr.updateEmployee({ params: { id: employee.id }, body }))
        : unwrap(
            await apiModules.hr.createEmployee({
              body: {
                ...body,
                status: 'ACTIVE',
                ...(canSetPay && salary !== ''
                  ? {
                      contract: {
                        type: contractType,
                        startDate: hireDate,
                        baseSalary: salary,
                        salaryPeriod: 'MONTHLY' as const,
                        weeklyHours: '44',
                      },
                    }
                  : {}),
              },
            }),
          );
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['hr'] });
      toast.success(t('Employé enregistré'));
      onSaved?.(saved);
      onClose();
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      width="lg"
      title={employee ? t('Modifier l’employé') : t('Nouvel employé')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!firstName.trim() || !lastName.trim() || !hireDate}
            onClick={() => save.mutate()}
          >
            {t('Enregistrer')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNote>{error}</ErrorNote>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Prénom')} required>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
          </Field>
          <Field label={t('Nom')} required>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
          <Field label={t('Fonction')}>
            <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </Field>
          <Field label={t('Département')}>
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">{t('— Aucun —')}</option>
              {departments.data?.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('Date d’embauche')} required>
            <Input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
          </Field>
          <Field label={t('Date de naissance')}>
            <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </Field>
          <Field label={t('CIN')}>
            <Input value={cin} onChange={(e) => setCin(e.target.value.toUpperCase())} />
          </Field>
          <Field label={t('N° CNSS')}>
            <Input value={cnss} onChange={(e) => setCnss(e.target.value)} />
          </Field>
          <Field label={t('Téléphone')}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label={t('E-mail')}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('Situation familiale')}>
            <Select value={marital} onChange={(e) => setMarital(e.target.value as typeof marital)}>
              {MARITAL.map(([value, text]) => (
                <option key={value} value={value}>
                  {t(text)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('Personnes à charge')} hint={t('Conjoint et enfants (déduction IR)')}>
            <NumberInput value={dependents} onChange={(e) => setDependents(e.target.value)} />
          </Field>
        </div>

        {canSetPay && (
          <div className="space-y-3 rounded-xl border border-border p-4">
            <p className="text-sm font-semibold text-ink">{t('Paie')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Banque')}>
                <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </Field>
              <Field label={t('RIB')}>
                <Input value={rib} onChange={(e) => setRib(e.target.value)} />
              </Field>
              {!employee && (
                <>
                  <Field label={t('Type de contrat')}>
                    <Select
                      value={contractType}
                      onChange={(e) => setContractType(e.target.value as typeof contractType)}
                    >
                      {CONTRACT_TYPES.map(([value, text]) => (
                        <option key={value} value={value}>
                          {t(text)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('Salaire mensuel brut')} hint={t('Laissez vide pour l’ajouter plus tard')}>
                    <NumberInput value={salary} onChange={(e) => setSalary(e.target.value)} />
                  </Field>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

