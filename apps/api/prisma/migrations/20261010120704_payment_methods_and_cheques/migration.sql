-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "dueDate" DATE,
ADD COLUMN     "methodId" UUID,
ADD COLUMN     "status" "PaymentStatus" NOT NULL DEFAULT 'CLEARED';

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PaymentMethod" NOT NULL DEFAULT 'OTHER',
    "requiresReference" BOOLEAN NOT NULL DEFAULT false,
    "deferred" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_status_events" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "userId" UUID,

    CONSTRAINT "payment_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_organizationId_name_key" ON "payment_methods"("organizationId", "name");

-- CreateIndex
CREATE INDEX "payment_status_events_paymentId_idx" ON "payment_status_events"("paymentId");

-- CreateIndex
CREATE INDEX "payments_companyId_status_dueDate_idx" ON "payments"("companyId", "status", "dueDate");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_status_events" ADD CONSTRAINT "payment_status_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: uncleared cheques / bills of exchange are still pending.
UPDATE "payments" SET "status" = 'PENDING'
WHERE "method" IN ('CHEQUE', 'BILL_OF_EXCHANGE') AND "clearedAt" IS NULL;

-- Default methods for every existing organization.
INSERT INTO "payment_methods" ("id", "organizationId", "name", "kind", "requiresReference", "deferred", "sortOrder")
SELECT gen_random_uuid(), o."id", d."name", d."kind"::"PaymentMethod", d."req", d."def", d."ord"
FROM "organizations" o
CROSS JOIN (VALUES
  ('Espèces', 'CASH', false, false, 1),
  ('Virement', 'BANK_TRANSFER', true, false, 2),
  ('Chèque', 'CHEQUE', true, true, 3),
  ('Effet de commerce', 'BILL_OF_EXCHANGE', true, true, 4),
  ('Carte bancaire', 'CARD', false, false, 5),
  ('Autre', 'OTHER', false, false, 6)
) AS d("name", "kind", "req", "def", "ord");
