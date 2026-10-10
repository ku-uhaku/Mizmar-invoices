-- CreateEnum
CREATE TYPE "ExpenseCategoryKind" AS ENUM ('UTILITY', 'RENT', 'INSURANCE', 'FUEL', 'SUPPLIES', 'SALARY', 'TAX', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'UNPAID', 'PARTIAL', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ExpenseCategoryKind" NOT NULL DEFAULT 'OTHER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "supplierId" UUID,
    "reference" TEXT,
    "description" TEXT,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE,
    "periodStart" DATE,
    "periodEnd" DATE,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "amountExclVat" DECIMAL(18,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL,
    "totalInclVat" DECIMAL(18,2) NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'UNPAID',
    "scanAssetId" UUID,
    "recurringId" UUID,
    "recurringPeriod" DATE,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_payments" (
    "id" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paidAt" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_expenses" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "supplierId" UUID,
    "name" TEXT NOT NULL,
    "amountExclVat" DECIMAL(18,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "frequency" "RecurringFrequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "dueInDays" INTEGER NOT NULL DEFAULT 15,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "nextRunAt" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_organizationId_name_key" ON "expense_categories"("organizationId", "name");

-- CreateIndex
CREATE INDEX "expenses_companyId_issueDate_idx" ON "expenses"("companyId", "issueDate");

-- CreateIndex
CREATE INDEX "expenses_companyId_status_dueDate_idx" ON "expenses"("companyId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "expenses_categoryId_idx" ON "expenses"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_recurringId_recurringPeriod_key" ON "expenses"("recurringId", "recurringPeriod");

-- CreateIndex
CREATE INDEX "expense_payments_expenseId_idx" ON "expense_payments"("expenseId");

-- CreateIndex
CREATE INDEX "expense_payments_paidAt_idx" ON "expense_payments"("paidAt");

-- CreateIndex
CREATE INDEX "recurring_expenses_isActive_nextRunAt_idx" ON "recurring_expenses"("isActive", "nextRunAt");

-- CreateIndex
CREATE INDEX "recurring_expenses_companyId_idx" ON "recurring_expenses"("companyId");

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_scanAssetId_fkey" FOREIGN KEY ("scanAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "recurring_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
