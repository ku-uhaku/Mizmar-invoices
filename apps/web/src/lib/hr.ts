import type { hrSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import type { BadgeTone } from '@/components/ui';

export type Employee = z.infer<typeof hrSchemas.employee>;
export type Contract = z.infer<typeof hrSchemas.contract>;
export type LeaveRequest = z.infer<typeof hrSchemas.leaveRequest>;
export type LeaveType = z.infer<typeof hrSchemas.leaveType>;
export type AttendanceRow = z.infer<typeof hrSchemas.attendanceRow>;
export type AttendanceStatus = AttendanceRow['status'] & string;

export const CONTRACT_TYPES: Array<[Contract['type'], string]> = [
  ['CDI', 'CDI (durée indéterminée)'],
  ['CDD', 'CDD (durée déterminée)'],
  ['ANAPEC', 'Contrat ANAPEC'],
  ['INTERN', 'Stage'],
  ['OTHER', 'Autre'],
];

export const MARITAL: Array<[Employee['maritalStatus'], string]> = [
  ['SINGLE', 'Célibataire'],
  ['MARRIED', 'Marié(e)'],
  ['DIVORCED', 'Divorcé(e)'],
  ['WIDOWED', 'Veuf / veuve'],
];

export const LEAVE_STATUS: Record<LeaveRequest['status'], { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'En attente', tone: 'progress' },
  APPROVED: { label: 'Approuvé', tone: 'success' },
  REJECTED: { label: 'Refusé', tone: 'danger' },
  CANCELLED: { label: 'Annulé', tone: 'neutral' },
};

export const ATTENDANCE: Array<[AttendanceStatus, string]> = [
  ['PRESENT', 'Présent'],
  ['LATE', 'En retard'],
  ['ABSENT', 'Absent'],
  ['LEAVE', 'En congé'],
  ['HOLIDAY', 'Jour férié'],
];

export const label = <T extends string>(list: Array<[T, string]>, value: T): string =>
  list.find(([key]) => key === value)?.[1] ?? value;
