-- CreateEnum
CREATE TYPE "TrackingMode" AS ENUM ('NONE', 'LOT', 'SERIAL');

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "tracking" "TrackingMode" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "stock_lots" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "expiryDate" DATE,
    "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "note" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lot_movements" (
    "id" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "movementId" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_lot_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_lots_warehouseId_expiryDate_idx" ON "stock_lots"("warehouseId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lots_variantId_warehouseId_lotNumber_key" ON "stock_lots"("variantId", "warehouseId", "lotNumber");

-- CreateIndex
CREATE INDEX "stock_lot_movements_lotId_idx" ON "stock_lot_movements"("lotId");

-- CreateIndex
CREATE INDEX "stock_lot_movements_movementId_idx" ON "stock_lot_movements"("movementId");

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot_movements" ADD CONSTRAINT "stock_lot_movements_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot_movements" ADD CONSTRAINT "stock_lot_movements_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "stock_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
