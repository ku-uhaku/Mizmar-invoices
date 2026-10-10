import { dec, type Decimal } from '../money';

/**
 * Moroccan monthly payroll: gross to net.
 *
 * Every rate lives in `PayrollRules` (stored per company, effective-dated), never
 * in the calculation, because contribution rates, ceilings and the income-tax
 * scale change with each finance law. `DEFAULT_PAYROLL_RULES` is only the
 * starting point.
 */

export interface IrBracket {
  /** Upper bound of the bracket, in annual taxable dirhams; null for the last one. */
  upTo: number | null;
  /** Percent. */
  rate: number;
  /** "Somme à déduire": amount subtracted from rate x income. */
  deduct: number;
}

export interface PayrollRules {
  /** CNSS short and long-term benefits, employee share, percent (capped base). */
  cnssEmployeeRate: number;
  cnssEmployerRate: number;
  /** Monthly ceiling of the CNSS base. */
  cnssCeiling: number;
  /** Mandatory health insurance (AMO), uncapped. */
  amoEmployeeRate: number;
  amoEmployerRate: number;
  familyAllowanceEmployerRate: number;
  trainingTaxEmployerRate: number;
  /** Employer-only extra rate on gross (e.g. a solidarity contribution); 0 when not applicable. */
  otherEmployerRate: number;
  /** Professional expenses: rate while the monthly gross is at or under the threshold, else the high rate. */
  professionalExpenses: { lowRate: number; highRate: number; monthlyThreshold: number; monthlyCap: number };
  /** Annual deduction per dependent from the computed tax, up to `maxDependents`. */
  familyDeductionAnnual: number;
  maxDependents: number;
  /** Annual income-tax scale. */
  irBrackets: IrBracket[];
  /** Days a month is divided into to price an unpaid day. */
  workingDaysPerMonth: number;
  /** Overtime multiplier on the hourly rate (1.25 = +25%). */
  overtimeMultiplier: number;
}

/** Morocco, finance law 2025 income-tax scale and the 2025-26 CNSS/AMO rates. Verify before relying on it. */
export const DEFAULT_PAYROLL_RULES: PayrollRules = {
  cnssEmployeeRate: 4.48,
  cnssEmployerRate: 8.98,
  cnssCeiling: 6000,
  amoEmployeeRate: 2.26,
  amoEmployerRate: 4.11,
  familyAllowanceEmployerRate: 6.4,
  trainingTaxEmployerRate: 1.6,
  otherEmployerRate: 0,
  professionalExpenses: { lowRate: 35, highRate: 25, monthlyThreshold: 6500, monthlyCap: 2916.67 },
  familyDeductionAnnual: 500,
  maxDependents: 6,
  irBrackets: [
    { upTo: 40000, rate: 0, deduct: 0 },
    { upTo: 60000, rate: 10, deduct: 4000 },
    { upTo: 80000, rate: 20, deduct: 10000 },
    { upTo: 100000, rate: 30, deduct: 18000 },
    { upTo: 180000, rate: 34, deduct: 22000 },
    { upTo: null, rate: 37, deduct: 27400 },
  ],
  workingDaysPerMonth: 26,
  overtimeMultiplier: 1.25,
};

export interface PayItem {
  label: string;
  amount: string;
}

export interface PayslipInput {
  /** Full-month gross base salary (monthly), or the hourly rate when `hourly`. */
  baseSalary: string;
  hourly?: boolean;
  weeklyHours: string;
  /** Share of the month worked, 0..1 (hire or departure mid-month). */
  proration: number;
  unpaidDays: string;
  overtimeMinutes: number;
  /** Taxable, CNSS-liable additions: bonuses, allowances. */
  additions: PayItem[];
  /** Taken after tax from the net: advances repayment excluded (see advance), fines, loans. */
  deductions: PayItem[];
  advanceDeduction: string;
  dependents: number;
}

export interface PayslipResult {
  base: string;
  unpaidDeduction: string;
  overtimePay: string;
  additionsTotal: string;
  gross: string;
  cnssBase: string;
  cnssEmployee: string;
  amoEmployee: string;
  professionalExpenses: string;
  taxableNet: string;
  incomeTax: string;
  deductionsTotal: string;
  advanceDeduction: string;
  netPay: string;
  cnssEmployer: string;
  familyAllowance: string;
  trainingTax: string;
  amoEmployer: string;
  otherEmployer: string;
  employerContributions: string;
  employerCost: string;
}

const money = (value: Decimal): Decimal => value.toDecimalPlaces(2, 4); // 4 = ROUND_HALF_UP
const pct = (amount: Decimal, rate: number): Decimal => money(amount.times(rate).div(100));
const f = (value: Decimal): string => value.toFixed(2);

/** Income tax for one month from the annual scale, before the family deduction. */
export function monthlyIncomeTax(taxableMonthly: Decimal, brackets: IrBracket[]): Decimal {
  const annual = taxableMonthly.times(12);
  const bracket = brackets.find((b) => b.upTo === null || annual.lte(b.upTo));
  if (!bracket) return dec(0);
  const yearly = annual.times(bracket.rate).div(100).minus(bracket.deduct);
  return yearly.lt(0) ? dec(0) : yearly.div(12);
}

export function computePayslip(rules: PayrollRules, input: PayslipInput): PayslipResult {
  const hoursPerMonth = dec(input.weeklyHours).times(52).div(12);
  const monthlyBase = input.hourly ? dec(input.baseSalary).times(hoursPerMonth) : dec(input.baseSalary);
  const base = money(monthlyBase.times(input.proration));
  const hourlyRate = hoursPerMonth.gt(0) ? monthlyBase.div(hoursPerMonth) : dec(0);

  const rawUnpaid = money(monthlyBase.div(rules.workingDaysPerMonth).times(dec(input.unpaidDays)));
  const unpaidDeduction = rawUnpaid.gt(base) ? base : rawUnpaid;
  const overtimePay = money(
    hourlyRate.times(input.overtimeMinutes).div(60).times(rules.overtimeMultiplier),
  );
  const additionsTotal = input.additions.reduce((acc, item) => acc.plus(dec(item.amount)), dec(0));
  const gross = money(base.minus(unpaidDeduction).plus(overtimePay).plus(additionsTotal));

  const cnssBase = gross.gt(rules.cnssCeiling) ? dec(rules.cnssCeiling) : gross;
  const cnssEmployee = pct(cnssBase, rules.cnssEmployeeRate);
  const amoEmployee = pct(gross, rules.amoEmployeeRate);

  const pe = rules.professionalExpenses;
  const peRate = gross.lte(pe.monthlyThreshold) ? pe.lowRate : pe.highRate;
  const rawPe = pct(gross, peRate);
  const professionalExpenses = rawPe.gt(pe.monthlyCap) ? dec(pe.monthlyCap) : rawPe;

  const taxableRaw = gross.minus(professionalExpenses).minus(cnssEmployee).minus(amoEmployee);
  const taxableNet = taxableRaw.lt(0) ? dec(0) : taxableRaw;
  const familyDeduction = dec(Math.min(input.dependents, rules.maxDependents))
    .times(rules.familyDeductionAnnual)
    .div(12);
  const taxRaw = money(monthlyIncomeTax(taxableNet, rules.irBrackets).minus(familyDeduction));
  const incomeTax = taxRaw.lt(0) ? dec(0) : taxRaw;

  const deductionsTotal = input.deductions.reduce((acc, item) => acc.plus(dec(item.amount)), dec(0));
  const advance = dec(input.advanceDeduction);
  const netPay = money(
    gross.minus(cnssEmployee).minus(amoEmployee).minus(incomeTax).minus(deductionsTotal).minus(advance),
  );

  const cnssEmployer = pct(cnssBase, rules.cnssEmployerRate);
  const familyAllowance = pct(gross, rules.familyAllowanceEmployerRate);
  const trainingTax = pct(gross, rules.trainingTaxEmployerRate);
  const amoEmployer = pct(gross, rules.amoEmployerRate);
  const otherEmployer = pct(gross, rules.otherEmployerRate);
  const employerContributions = cnssEmployer
    .plus(familyAllowance)
    .plus(trainingTax)
    .plus(amoEmployer)
    .plus(otherEmployer);

  return {
    base: f(base),
    unpaidDeduction: f(unpaidDeduction),
    overtimePay: f(overtimePay),
    additionsTotal: f(additionsTotal),
    gross: f(gross),
    cnssBase: f(cnssBase),
    cnssEmployee: f(cnssEmployee),
    amoEmployee: f(amoEmployee),
    professionalExpenses: f(professionalExpenses),
    taxableNet: f(taxableNet),
    incomeTax: f(incomeTax),
    deductionsTotal: f(deductionsTotal),
    advanceDeduction: f(advance),
    netPay: f(netPay),
    cnssEmployer: f(cnssEmployer),
    familyAllowance: f(familyAllowance),
    trainingTax: f(trainingTax),
    amoEmployer: f(amoEmployer),
    otherEmployer: f(otherEmployer),
    employerContributions: f(employerContributions),
    employerCost: f(gross.plus(employerContributions)),
  };
}
