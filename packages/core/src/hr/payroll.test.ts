import { describe, expect, it } from 'vitest';
import { dec } from '../money';
import { computePayslip, DEFAULT_PAYROLL_RULES, monthlyIncomeTax, type PayslipInput } from './payroll';

const input = (over: Partial<PayslipInput> = {}): PayslipInput => ({
  baseSalary: '10000',
  weeklyHours: '44',
  proration: 1,
  unpaidDays: '0',
  overtimeMinutes: 0,
  additions: [],
  deductions: [],
  advanceDeduction: '0',
  dependents: 0,
  ...over,
});

describe('computePayslip', () => {
  it('10 000 gross: capped CNSS, uncapped AMO, 25% professional expenses, 30% bracket', () => {
    const r = computePayslip(DEFAULT_PAYROLL_RULES, input());
    expect(r.cnssEmployee).toBe('268.80'); // 4.48% of the 6 000 ceiling
    expect(r.amoEmployee).toBe('226.00'); // 2.26% of 10 000
    expect(r.professionalExpenses).toBe('2500.00'); // 25% above 6 500
    expect(r.taxableNet).toBe('7005.20');
    // 7 005.20 x 12 = 84 062.40 -> 30% - 18 000 = 7 218.72 a year -> 601.56 a month
    expect(r.incomeTax).toBe('601.56');
    expect(r.netPay).toBe('8903.64');
  });

  it('is tax free at 5 000 gross', () => {
    const r = computePayslip(DEFAULT_PAYROLL_RULES, input({ baseSalary: '5000' }));
    expect(r.professionalExpenses).toBe('1750.00'); // 35% at or under 6 500
    expect(r.incomeTax).toBe('0.00');
    expect(r.netPay).toBe('4663.00'); // 5 000 - 224 - 113
  });

  it('caps professional expenses', () => {
    const r = computePayslip(DEFAULT_PAYROLL_RULES, input({ baseSalary: '30000' }));
    expect(r.professionalExpenses).toBe('2916.67');
  });

  it('deducts the family allowance from the tax, never below zero', () => {
    const none = computePayslip(DEFAULT_PAYROLL_RULES, input());
    const three = computePayslip(DEFAULT_PAYROLL_RULES, input({ dependents: 3 }));
    // 3 x 500 / 12 = 125 a month
    expect(dec(none.incomeTax).minus(three.incomeTax).toFixed(2)).toBe('125.00');
    const many = computePayslip(DEFAULT_PAYROLL_RULES, input({ baseSalary: '6000', dependents: 6 }));
    expect(many.incomeTax).toBe('0.00');
  });

  it('employer contributions and total cost', () => {
    const r = computePayslip(DEFAULT_PAYROLL_RULES, input());
    expect(r.cnssEmployer).toBe('538.80'); // 8.98% of 6 000
    expect(r.familyAllowance).toBe('640.00'); // 6.40% of 10 000
    expect(r.trainingTax).toBe('160.00');
    expect(r.amoEmployer).toBe('411.00');
    expect(r.employerContributions).toBe('1749.80');
    expect(r.employerCost).toBe('11749.80');
  });

  it('prices unpaid days on a 26-day month and never below zero', () => {
    const r = computePayslip(DEFAULT_PAYROLL_RULES, input({ baseSalary: '2600', unpaidDays: '2' }));
    expect(r.unpaidDeduction).toBe('200.00');
    expect(r.gross).toBe('2400.00');
    const all = computePayslip(DEFAULT_PAYROLL_RULES, input({ baseSalary: '2600', unpaidDays: '40' }));
    expect(all.gross).toBe('0.00');
  });

  it('pays overtime at 125% of the hourly rate', () => {
    // 44 h/week -> 190.67 h/month; 9 534 / 190.67 = 50 an hour; 2 h x 50 x 1.25 = 125
    const r = computePayslip(DEFAULT_PAYROLL_RULES, input({ baseSalary: '9533.33', overtimeMinutes: 120 }));
    expect(r.overtimePay).toBe('125.00');
  });

  it('prorates the base for a partial month', () => {
    const r = computePayslip(DEFAULT_PAYROLL_RULES, input({ baseSalary: '6000', proration: 0.5 }));
    expect(r.base).toBe('3000.00');
  });

  it('adds bonuses to the taxable gross and takes deductions and advances from the net', () => {
    const r = computePayslip(
      DEFAULT_PAYROLL_RULES,
      input({
        baseSalary: '5000',
        additions: [{ label: 'Prime', amount: '1000' }],
        deductions: [{ label: 'Amende', amount: '50' }],
        advanceDeduction: '200',
      }),
    );
    expect(r.gross).toBe('6000.00');
    // taxable = 6 000 - 2 100 (35%) - 268.80 - 135.60 = 3 495.60 -> 41 947.20 a year
    // -> 10% - 4 000 = 194.72 a year -> 16.23 a month
    expect(r.incomeTax).toBe('16.23');
    expect(r.netPay).toBe('5329.37'); // 6 000 - 268.80 - 135.60 - 16.23 - 50 - 200
  });
});

describe('monthlyIncomeTax', () => {
  it('is zero up to 40 000 a year and continuous at the bracket edge', () => {
    expect(monthlyIncomeTax(dec(3333.33), DEFAULT_PAYROLL_RULES.irBrackets).toFixed(2)).toBe('0.00');
    const at = monthlyIncomeTax(dec(5000), DEFAULT_PAYROLL_RULES.irBrackets); // 60 000 a year
    expect(at.toFixed(2)).toBe('166.67'); // 10% x 60 000 - 4 000 = 2 000 / 12
  });
});
