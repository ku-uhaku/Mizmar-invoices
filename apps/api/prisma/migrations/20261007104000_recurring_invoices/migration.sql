-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "RecurringMode" AS ENUM ('DRAFT', 'VALIDATE', 'VALIDATE_AND_EMAIL');

-- CreateEnum
CREATE TYPE "RecurringRunStatus" AS ENUM ('OK', 'FAILED');

-- CreateTable
CREATE TABLE "recurring_invoices" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "template" JSONB NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "maxOccurrences" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Casablanca',
    "nextRunAt" DATE,
    "lastRunAt" TIMESTAMP(3),
    "occurrencesCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "mode" "RecurringMode" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_invoice_runs" (
    "id" UUID NOT NULL,
    "recurringId" UUID NOT NULL,
    "documentId" UUID,
    "scheduledFor" DATE NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RecurringRunStatus" NOT NULL,
    "error" TEXT,

    CONSTRAINT "recurring_invoice_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_invoices_isActive_nextRunAt_idx" ON "recurring_invoices"("isActive", "nextRunAt");

-- CreateIndex
CREATE INDEX "recurring_invoices_companyId_idx" ON "recurring_invoices"("companyId");

-- CreateIndex
CREATE INDEX "recurring_invoice_runs_documentId_idx" ON "recurring_invoice_runs"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_invoice_runs_recurringId_scheduledFor_key" ON "recurring_invoice_runs"("recurringId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_runs" ADD CONSTRAINT "recurring_invoice_runs_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "recurring_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_runs" ADD CONSTRAINT "recurring_invoice_runs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

