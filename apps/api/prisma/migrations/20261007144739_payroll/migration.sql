-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'VALIDATED', 'PAID');

-- CreateTable
CREATE TABLE "payroll_rule_sets" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "rules" JSONB NOT NULL,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "totalGross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalEmployerCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "validatedAt" TIMESTAMP(3),
    "validatedById" UUID,
    "paidAt" DATE,
    "expenseId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "employeeSnapshot" JSONB NOT NULL,
    "rulesSnapshot" JSONB NOT NULL,
    "baseSalary" DECIMAL(18,2) NOT NULL,
    "weeklyHours" DECIMAL(5,2) NOT NULL DEFAULT 44,
    "hourly" BOOLEAN NOT NULL DEFAULT false,
    "dependents" INTEGER NOT NULL DEFAULT 0,
    "proration" DECIMAL(6,4) NOT NULL DEFAULT 1,
    "unpaidDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "additions" JSONB NOT NULL DEFAULT '[]',
    "deductions" JSONB NOT NULL DEFAULT '[]',
    "unpaidDeduction" DECIMAL(18,2) NOT NULL,
    "overtimePay" DECIMAL(18,2) NOT NULL,
    "grossSalary" DECIMAL(18,2) NOT NULL,
    "cnssBase" DECIMAL(18,2) NOT NULL,
    "cnssEmployee" DECIMAL(18,2) NOT NULL,
    "amoEmployee" DECIMAL(18,2) NOT NULL,
    "professionalExpenses" DECIMAL(18,2) NOT NULL,
    "taxableNet" DECIMAL(18,2) NOT NULL,
    "incomeTax" DECIMAL(18,2) NOT NULL,
    "advanceDeduction" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(18,2) NOT NULL,
    "cnssEmployer" DECIMAL(18,2) NOT NULL,
    "familyAllowance" DECIMAL(18,2) NOT NULL,
    "trainingTax" DECIMAL(18,2) NOT NULL,
    "amoEmployer" DECIMAL(18,2) NOT NULL,
    "otherEmployer" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employerContributions" DECIMAL(18,2) NOT NULL,
    "employerCost" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_advances" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "date" DATE NOT NULL,
    "monthlyRepayment" DECIMAL(18,2) NOT NULL,
    "repaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_advances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_rule_sets_companyId_effectiveFrom_key" ON "payroll_rule_sets"("companyId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_companyId_year_month_key" ON "payroll_runs"("companyId", "year", "month");

-- CreateIndex
CREATE INDEX "payslips_employeeId_idx" ON "payslips"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_runId_employeeId_key" ON "payslips"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "salary_advances_companyId_employeeId_idx" ON "salary_advances"("companyId", "employeeId");

-- AddForeignKey
ALTER TABLE "payroll_rule_sets" ADD CONSTRAINT "payroll_rule_sets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_runId_fkey" FOREIGN KEY ("runId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
