/*
  Warnings:

  - You are about to drop the column `averageCost` on the `product_variants` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "product_variants" DROP COLUMN "averageCost";

-- AlterTable
ALTER TABLE "stock_levels" ADD COLUMN     "averageCost" DECIMAL(18,6) NOT NULL DEFAULT 0;
