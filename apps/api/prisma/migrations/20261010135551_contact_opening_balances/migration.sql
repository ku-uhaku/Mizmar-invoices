-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'OPENING';

-- CreateTable
CREATE TABLE "contact_opening_balances" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "asOf" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_opening_balances_companyId_contactId_key" ON "contact_opening_balances"("companyId", "contactId");

-- AddForeignKey
ALTER TABLE "contact_opening_balances" ADD CONSTRAINT "contact_opening_balances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_opening_balances" ADD CONSTRAINT "contact_opening_balances_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
