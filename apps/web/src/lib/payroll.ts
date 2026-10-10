import type { payrollSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import type { BadgeTone } from '@/components/ui';

export type RunSummary = z.infer<typeof payrollSchemas.runSummary>;
export type RunDetail = z.infer<typeof payrollSchemas.runDetail>;
export type PayslipRow = z.infer<typeof payrollSchemas.payslipRow>;
export type Payslip = z.infer<typeof payrollSchemas.payslip>;
export type PayrollRules = z.infer<typeof payrollSchemas.payrollRules>;

export const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export const RUN_STATUS: Record<RunSummary['status'], { label: string; tone: BadgeTone }> = {
  DRAFT: { label: 'Brouillon', tone: 'neutral' },
  VALIDATED: { label: 'Validée', tone: 'info' },
  PAID: { label: 'Payée', tone: 'success' },
};
