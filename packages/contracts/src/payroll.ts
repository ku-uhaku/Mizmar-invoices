import { z } from 'zod';
import {
  decimalString,
  isoDate,
  isoDateTime,
  nonNegativeDecimalString,
  paymentMethodEnum,
  positiveDecimalString,
  uuid,
} from './common';

export const payrollStatusEnum = z.enum(['DRAFT', 'VALIDATED', 'PAID']);

// -- Rules -------------------------------------------------------------------

const rate = z.number().min(0).max(100);
const amount = z.number().min(0).max(100_000_000);

export const irBracket = z.object({
  upTo: amount.nullable(),
  rate,
  deduct: amount,
});

export const payrollRules = z.object({
  cnssEmployeeRate: rate,
  cnssEmployerRate: rate,
  cnssCeiling: amount,
  amoEmployeeRate: rate,
  amoEmployerRate: rate,
  familyAllowanceEmployerRate: rate,
  trainingTaxEmployerRate: rate,
  otherEmployerRate: rate,
  professionalExpenses: z.object({
    lowRate: rate,
    highRate: rate,
    monthlyThreshold: amount,
    monthlyCap: amount,
  }),
  familyDeductionAnnual: amount,
  maxDependents: z.number().int().min(0).max(20),
  irBrackets: z
    .array(irBracket)
    .min(1)
    .max(12)
    .refine((brackets) => brackets[brackets.length - 1]!.upTo === null, {
      message: 'the last bracket must have no upper bound',
    }),
  workingDaysPerMonth: z.number().min(1).max(31),
  overtimeMultiplier: z.number().min(1).max(5),
});

export const payrollRulesResponse = z.object({
  rules: payrollRules,
  /** Null while the built-in defaults apply. */
  effectiveFrom: isoDate.nullable(),
  source: z.enum(['default', 'custom']),
});

export const payrollRulesSave = z.object({
  effectiveFrom: isoDate,
  rules: payrollRules,
  note: z.string().max(300).nullish(),
});

// -- Payslips ----------------------------------------------------------------

export const payItem = z.object({
  label: z.string().min(1).max(100),
  amount: nonNegativeDecimalString,
});

export const payslipUpdate = z.object({
  unpaidDays: nonNegativeDecimalString.optional(),
  overtimeMinutes: z.number().int().min(0).max(100_000).optional(),
  additions: z.array(payItem).max(20).optional(),
  deductions: z.array(payItem).max(20).optional(),
});

export const payslipRow = z.object({
  id: uuid,
  employeeId: uuid,
  employeeName: z.string(),
  employeeNumber: z.string(),
  baseSalary: decimalString,
  unpaidDays: decimalString,
  overtimeMinutes: z.number().int(),
  grossSalary: decimalString,
  cnssEmployee: decimalString,
  amoEmployee: decimalString,
  incomeTax: decimalString,
  advanceDeduction: decimalString,
  netPay: decimalString,
  employerCost: decimalString,
});

export const payslip = payslipRow.extend({
  runId: uuid,
  year: z.number().int(),
  month: z.number().int(),
  status: payrollStatusEnum,
  employee: z.object({
    fullName: z.string(),
    employeeNumber: z.string(),
    cin: z.string().nullable(),
    cnssNumber: z.string().nullable(),
    jobTitle: z.string().nullable(),
    departmentName: z.string().nullable(),
    hireDate: isoDate,
    bankName: z.string().nullable(),
    rib: z.string().nullable(),
    maritalStatus: z.string(),
    dependents: z.number().int(),
  }),
  weeklyHours: decimalString,
  proration: decimalString,
  additions: z.array(payItem),
  deductions: z.array(payItem),
  unpaidDeduction: decimalString,
  overtimePay: decimalString,
  cnssBase: decimalString,
  professionalExpenses: decimalString,
  taxableNet: decimalString,
  deductionsTotal: decimalString,
  cnssEmployer: decimalString,
  familyAllowance: decimalString,
  trainingTax: decimalString,
  amoEmployer: decimalString,
  otherEmployer: decimalString,
  employerContributions: decimalString,
});

// -- Runs --------------------------------------------------------------------

export const runCreate = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

export const runSummary = z.object({
  id: uuid,
  year: z.number().int(),
  month: z.number().int(),
  status: payrollStatusEnum,
  payslipCount: z.number().int(),
  totalGross: decimalString,
  totalNet: decimalString,
  totalEmployerCost: decimalString,
  paidAt: isoDate.nullable(),
  expenseId: uuid.nullable(),
  validatedAt: isoDateTime.nullable(),
});

export const runDetail = runSummary.extend({
  payslips: z.array(payslipRow),
  /** Employees left out of a new or recomputed run, and why. */
  skipped: z.array(z.object({ employeeName: z.string(), reason: z.string() })),
});

export const runPay = z.object({
  method: paymentMethodEnum,
  paidAt: isoDate,
});

// -- Advances ----------------------------------------------------------------

export const advanceCreate = z.object({
  employeeId: uuid,
  amount: positiveDecimalString,
  date: isoDate,
  monthlyRepayment: positiveDecimalString,
  note: z.string().max(300).nullish(),
});

export const advance = z.object({
  id: uuid,
  employeeId: uuid,
  employeeName: z.string(),
  amount: decimalString,
  date: isoDate,
  monthlyRepayment: decimalString,
  repaid: decimalString,
  remaining: decimalString,
  note: z.string().nullable(),
});

export type PayrollRules = z.infer<typeof payrollRules>;
export type RunSummary = z.infer<typeof runSummary>;
export type RunDetail = z.infer<typeof runDetail>;
export type Payslip = z.infer<typeof payslip>;
export type PayslipRow = z.infer<typeof payslipRow>;
export type Advance = z.infer<typeof advance>;
