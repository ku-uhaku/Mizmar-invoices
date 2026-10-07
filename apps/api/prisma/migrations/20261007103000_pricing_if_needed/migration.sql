-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "defaultPriceListId" UUID;

-- AlterTable
ALTER TABLE "price_lists" ADD COLUMN     "validFrom" DATE,
ADD COLUMN     "validTo" DATE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_defaultPriceListId_fkey" FOREIGN KEY ("defaultPriceListId") REFERENCES "price_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
