-- CreateEnum
CREATE TYPE "BankLineStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT,
    "iban" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "balance" DECIMAL(18,2),
    "fingerprint" TEXT NOT NULL,
    "status" "BankLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "paymentId" UUID,
    "expensePaymentId" UUID,
    "matchedAt" TIMESTAMP(3),
    "matchedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_accounts_companyId_idx" ON "bank_accounts"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_paymentId_key" ON "bank_statement_lines"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_expensePaymentId_key" ON "bank_statement_lines"("expensePaymentId");

-- CreateIndex
CREATE INDEX "bank_statement_lines_bankAccountId_date_idx" ON "bank_statement_lines"("bankAccountId", "date");

-- CreateIndex
CREATE INDEX "bank_statement_lines_bankAccountId_status_idx" ON "bank_statement_lines"("bankAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_bankAccountId_fingerprint_key" ON "bank_statement_lines"("bankAccountId", "fingerprint");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_expensePaymentId_fkey" FOREIGN KEY ("expensePaymentId") REFERENCES "expense_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
