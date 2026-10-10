'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiModules, ApiError, unwrap } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
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
import { ATTENDANCE, type AttendanceStatus } from '@/lib/hr';
import { useT } from '@/lib/i18n/provider';
import { useRole } from '@/lib/use-role';

interface Draft {
  status: AttendanceStatus | '';
  checkIn: string;
  checkOut: string;
  overtimeMinutes: string;
  note: string;
}

export default function AttendancePage() {
  const t = useT();
  const queryClient = useQueryClient();
  const { canManageHr } = useRole();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const rows = useQuery({
    queryKey: ['hr', 'attendance', day],
    queryFn: async () => unwrap(await apiModules.hr.attendanceDay({ query: { date: day } })),
  });

  // Start every day from what the server has recorded.
  useEffect(() => {
    if (!rows.data) return;
    setDrafts(
      Object.fromEntries(
        rows.data.map((row) => [
          row.employeeId,
          {
            status: row.status ?? '',
            checkIn: row.checkIn ?? '',
            checkOut: row.checkOut ?? '',
            overtimeMinutes: row.overtimeMinutes ? String(row.overtimeMinutes) : '',
            note: row.note ?? '',
          } satisfies Draft,
        ]),
      ),
    );
  }, [rows.data]);

  const patch = (id: string, change: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [id]: { ...current[id]!, ...change } }));

  const save = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(drafts)
        .filter(([, draft]) => draft.status !== '')
        .map(([employeeId, draft]) => ({
          employeeId,
          status: draft.status as AttendanceStatus,
          checkIn: draft.checkIn || null,
          checkOut: draft.checkOut || null,
          overtimeMinutes: Number(draft.overtimeMinutes) || 0,
          note: draft.note || null,
        }));
      return unwrap(await apiModules.hr.saveAttendance({ body: { date: day, entries } }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hr'] });
      toast.success(t('Présences enregistrées'));
    },
    onError: (cause) =>
      toast.error(cause instanceof ApiError ? cause.message : t('Enregistrement impossible')),
  });

  const markAllPresent = () =>
    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, draft]) => [
          id,
          draft.status === '' ? { ...draft, status: (rows.data?.find((r) => r.employeeId === id)?.onLeave ? 'LEAVE' : 'PRESENT') as AttendanceStatus } : draft,
        ]),
      ),
    );

  return (
    <>
      <PageHeader
        title={t('Présences')}
        subtitle={t('Saisie journalière : présent, retard, absence et heures supplémentaires')}
        actions={
          canManageHr && (
            <>
              <Button variant="secondary" onClick={markAllPresent}>
                {t('Marquer présents')}
              </Button>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
                {t('Enregistrer')}
              </Button>
            </>
          )
        }
      />

      <Card className="mb-4 flex items-end gap-3 p-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">{t('Date')}</span>
          <Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
      </Card>

      <Card className="overflow-hidden">
        {rows.isPending ? (
          <TableSkeleton rows={5} cols={6} />
        ) : rows.isError ? (
          <ErrorNote>{t('Chargement impossible')}</ErrorNote>
        ) : rows.data.length > 0 ? (
          <Table className="min-w-[860px]">
            <thead>
              <tr>
                <Th>{t('Employé')}</Th>
                <Th>{t('Statut')}</Th>
                <Th>{t('Arrivée')}</Th>
                <Th>{t('Départ')}</Th>
                <Th numeric>{t('Heures sup. (min)')}</Th>
                <Th>{t('Note')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.data.map((row) => {
                const draft = drafts[row.employeeId];
                if (!draft) return null;
                return (
                  <tr key={row.employeeId}>
                    <Td>
                      <span className="font-medium">{row.employeeName}</span>
                      <span className="ms-2 text-xs text-ink-muted">{row.employeeNumber}</span>
                      {row.onLeave && <Badge tone="info" className="ms-2">{t('En congé')}</Badge>}
                    </Td>
                    <Td>
                      <Select
                        value={draft.status}
                        disabled={!canManageHr}
                        onChange={(e) => patch(row.employeeId, { status: e.target.value as AttendanceStatus | '' })}
                        className="w-40"
                      >
                        <option value="">—</option>
                        {ATTENDANCE.map(([value, text]) => (
                          <option key={value} value={value}>
                            {t(text)}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td>
                      <Input type="time" value={draft.checkIn} disabled={!canManageHr} onChange={(e) => patch(row.employeeId, { checkIn: e.target.value })} className="w-32" />
                    </Td>
                    <Td>
                      <Input type="time" value={draft.checkOut} disabled={!canManageHr} onChange={(e) => patch(row.employeeId, { checkOut: e.target.value })} className="w-32" />
                    </Td>
                    <Td numeric>
                      <NumberInput value={draft.overtimeMinutes} disabled={!canManageHr} onChange={(e) => patch(row.employeeId, { overtimeMinutes: e.target.value })} className="w-24" />
                    </Td>
                    <Td>
                      <Input value={draft.note} disabled={!canManageHr} onChange={(e) => patch(row.employeeId, { note: e.target.value })} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon="users" title={t('Aucun employé en poste ce jour-là')} />
        )}
      </Card>
    </>
  );
}
