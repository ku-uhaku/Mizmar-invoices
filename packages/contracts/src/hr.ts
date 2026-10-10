import { z } from 'zod';
import {
  decimalString,
  isoDate,
  isoDateTime,
  nonNegativeDecimalString,
  uuid,
} from './common';

export const employeeStatusEnum = z.enum(['ACTIVE', 'TERMINATED']);
export const maritalStatusEnum = z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']);
export const contractTypeEnum = z.enum(['CDI', 'CDD', 'ANAPEC', 'INTERN', 'OTHER']);
export const salaryPeriodEnum = z.enum(['MONTHLY', 'HOURLY']);
export const leaveStatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
export const attendanceStatusEnum = z.enum(['PRESENT', 'ABSENT', 'LATE', 'HOLIDAY', 'LEAVE']);

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

// -- Departments -------------------------------------------------------------

export const department = z.object({
  id: uuid,
  name: z.string(),
  employeeCount: z.number().int(),
});
export const departmentBody = z.object({ name: z.string().min(1).max(100) });

// -- Contracts ---------------------------------------------------------------

export const contractBody = z.object({
  type: contractTypeEnum.default('CDI'),
  startDate: isoDate,
  endDate: isoDate.nullish(),
  baseSalary: nonNegativeDecimalString,
  salaryPeriod: salaryPeriodEnum.default('MONTHLY'),
  weeklyHours: nonNegativeDecimalString.default('44'),
});

export const contract = z.object({
  id: uuid,
  employeeId: uuid,
  type: contractTypeEnum,
  startDate: isoDate,
  endDate: isoDate.nullable(),
  /** Null for roles that may not read pay. */
  baseSalary: decimalString.nullable(),
  salaryPeriod: salaryPeriodEnum,
  weeklyHours: decimalString,
  isCurrent: z.boolean(),
});

// -- Employees ---------------------------------------------------------------

const employeeFields = {
  employeeNumber: z.string().min(1).max(30).optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  cin: z.string().max(30).nullish(),
  cnssNumber: z.string().max(30).nullish(),
  birthDate: isoDate.nullish(),
  hireDate: isoDate,
  terminationDate: isoDate.nullish(),
  jobTitle: z.string().max(120).nullish(),
  departmentId: uuid.nullish(),
  phone: z.string().max(40).nullish(),
  email: z.string().email().max(200).nullish().or(z.literal('')),
  address: z.string().max(300).nullish(),
  bankName: z.string().max(100).nullish(),
  rib: z.string().max(40).nullish(),
  status: employeeStatusEnum.default('ACTIVE'),
  maritalStatus: maritalStatusEnum.default('SINGLE'),
  dependents: z.number().int().min(0).max(20).default(0),
};

export const employeeCreate = z.object({
  ...employeeFields,
  /** Optional first contract, created together with the employee. */
  contract: contractBody.optional(),
});
export const employeeUpdate = z.object(employeeFields).partial();

export const employee = z.object({
  id: uuid,
  employeeNumber: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  cin: z.string().nullable(),
  cnssNumber: z.string().nullable(),
  birthDate: isoDate.nullable(),
  hireDate: isoDate,
  terminationDate: isoDate.nullable(),
  jobTitle: z.string().nullable(),
  departmentId: uuid.nullable(),
  departmentName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  bankName: z.string().nullable(),
  /** Null for roles that may not read pay. */
  rib: z.string().nullable(),
  status: employeeStatusEnum,
  maritalStatus: maritalStatusEnum,
  dependents: z.number().int(),
  currentContract: contract.nullable(),
});

export const employeeListQuery = z.object({
  status: employeeStatusEnum.optional(),
  departmentId: uuid.optional(),
  search: z.string().max(100).optional(),
});

// -- Leave -------------------------------------------------------------------

export const leaveType = z.object({
  id: uuid,
  name: z.string(),
  isPaid: z.boolean(),
  daysPerYear: decimalString,
  isActive: z.boolean(),
});
export const leaveTypeBody = z.object({
  name: z.string().min(1).max(100),
  isPaid: z.boolean().default(true),
  daysPerYear: nonNegativeDecimalString.default('0'),
  isActive: z.boolean().default(true),
});

export const leaveCreate = z.object({
  employeeId: uuid,
  typeId: uuid,
  startDate: isoDate,
  endDate: isoDate,
  /** Defaults to the working days (Mon-Sat) of the range. */
  days: nonNegativeDecimalString.optional(),
  reason: z.string().max(500).nullish(),
});

export const leaveRequest = z.object({
  id: uuid,
  employeeId: uuid,
  employeeName: z.string(),
  typeId: uuid,
  typeName: z.string(),
  isPaid: z.boolean(),
  startDate: isoDate,
  endDate: isoDate,
  days: decimalString,
  reason: z.string().nullable(),
  status: leaveStatusEnum,
  decidedAt: isoDateTime.nullable(),
});

export const leaveListQuery = z.object({
  status: leaveStatusEnum.optional(),
  employeeId: uuid.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const leaveDecision = z.object({ approve: z.boolean() });

export const leaveBalanceQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const leaveBalanceRow = z.object({
  employeeId: uuid,
  employeeName: z.string(),
  typeId: uuid,
  typeName: z.string(),
  entitlement: decimalString,
  taken: decimalString,
  pending: decimalString,
  remaining: decimalString,
});

// -- Attendance --------------------------------------------------------------

export const attendanceEntry = z.object({
  employeeId: uuid,
  status: attendanceStatusEnum,
  checkIn: time.nullish(),
  checkOut: time.nullish(),
  overtimeMinutes: z.number().int().min(0).max(1440).default(0),
  note: z.string().max(300).nullish(),
});

export const attendanceSave = z.object({
  date: isoDate,
  entries: z.array(attendanceEntry).min(1).max(1000),
});

export const attendanceDayQuery = z.object({ date: isoDate });

export const attendanceRow = z.object({
  employeeId: uuid,
  employeeName: z.string(),
  employeeNumber: z.string(),
  /** Null when nothing has been recorded for that day yet. */
  status: attendanceStatusEnum.nullable(),
  checkIn: z.string().nullable(),
  checkOut: z.string().nullable(),
  overtimeMinutes: z.number().int(),
  note: z.string().nullable(),
  /** True when an approved leave covers the day. */
  onLeave: z.boolean(),
});

// -- Overview ----------------------------------------------------------------

export const hrOverview = z.object({
  headcount: z.number().int(),
  onLeaveToday: z.number().int(),
  pendingLeave: z.number().int(),
  absentToday: z.number().int(),
  contractsEndingSoon: z.array(
    z.object({ employeeId: uuid, employeeName: z.string(), endDate: isoDate }),
  ),
});

export type Employee = z.infer<typeof employee>;
export type EmployeeCreate = z.infer<typeof employeeCreate>;
export type Contract = z.infer<typeof contract>;
export type LeaveRequest = z.infer<typeof leaveRequest>;
export type LeaveType = z.infer<typeof leaveType>;
export type AttendanceRow = z.infer<typeof attendanceRow>;
export type HrOverview = z.infer<typeof hrOverview>;
