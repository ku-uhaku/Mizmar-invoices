-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('EMAIL');

-- CreateTable
CREATE TABLE "payment_reminders" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentById" UUID,
    "channel" "ReminderChannel" NOT NULL DEFAULT 'EMAIL',
    "level" INTEGER NOT NULL DEFAULT 1,
    "recipient" TEXT,

    CONSTRAINT "payment_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_reminders_documentId_sentAt_idx" ON "payment_reminders"("documentId", "sentAt");

-- CreateIndex
CREATE INDEX "payment_reminders_companyId_sentAt_idx" ON "payment_reminders"("companyId", "sentAt");

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
