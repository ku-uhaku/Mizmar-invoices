import { Injectable } from '@nestjs/common';
import {
  AdjustmentReason,
  MovementType,
  Prisma,
  StockDirection,
  type DocumentType as PrismaDocumentType,
} from '@prisma/client';
import {
  dec,
  type DocumentType,
  type PlannedMovement,
  type PlannedReservation,
  type StockImpactPlan,
} from '@mizmar/core';
import { AppError } from '../common/app-error';
import { toPrismaDecimal, toPrismaDecimalOrNull } from '../common/util/decimal';
import type { PrismaTx } from '../prisma/prisma.service';
import { syncLots } from './lots';

export interface LevelKey {
  variantId: string;
  warehouseId: string;
}

export interface LockedLevel {
  id: string;
  variantId: string;
  warehouseId: string;
  onHand: Prisma.Decimal;
  reserved: Prisma.Decimal;
  incoming: Prisma.Decimal;
  averageCost: Prisma.Decimal;
}

export interface MovementInput extends LevelKey {
  /** Signed: negative leaves the warehouse, positive enters it. */
  signedQuantity: string;
  type: MovementType;
  reason?: AdjustmentReason | null;
  unitCost?: string | null;
  documentId?: string | null;
  documentLineId?: string | null;
  countLineId?: string | null;
  transferLineId?: string | null;
  reversesMovementId?: string | null;
  note?: string | null;
  /** Receiving into a named lot (tracked variants only). */
  lot?: { lotNumber: string; expiryDate?: string | null } | null;
  /** Drawing from one specific lot, e.g. a write-off. */
  fromLotId?: string | null;
}

export interface ApplyOptions {
  userId: string | null;
  documentId?: string | null;
  /** Overrides the type derived from the document, for cancellations. */
  movementType?: MovementType;
}

/**
 * Writes the stock ledger.
 *
 * Every method takes an open transaction: stock must move in the same
 * transaction as the document validation that caused it, never in a job and
 * never "eventually". A half-validated document with no movements, or
 * movements with no document, would both be unrecoverable by hand.
 */
@Injectable()
export class StockService {
  // -------------------------------------------------------------------------
  // Level access
  // -------------------------------------------------------------------------

  /**
   * Read levels for a set of variant/warehouse pairs, creating missing rows,
   * and hold a row lock until the transaction ends.
   *
   * The lock is what makes `balanceAfter` trustworthy: without it two
   * concurrent deliveries of the same variant both read the same starting
   * balance and the ledger stops reconstructing.
   */
  async lockLevels(tx: PrismaTx, keys: LevelKey[]): Promise<Map<string, LockedLevel>> {
    const unique = new Map<string, LevelKey>();
    for (const key of keys) unique.set(levelKey(key), key);
    if (unique.size === 0) return new Map();

    // Insert any missing rows first, so the lock below finds every pair.
    await tx.stockLevel.createMany({
      data: [...unique.values()].map((k) => ({
        variantId: k.variantId,
        warehouseId: k.warehouseId,
      })),
      skipDuplicates: true,
    });

    // Deterministic order avoids deadlocks between two transactions that touch
    // an overlapping set of variants.
    const pairs = [...unique.values()].sort((a, b) =>
      levelKey(a).localeCompare(levelKey(b)),
    );

    const rows = await tx.$queryRaw<LockedLevel[]>`
      SELECT "id", "variantId", "warehouseId", "onHand", "reserved", "incoming", "averageCost"
      FROM "stock_levels"
      WHERE ("variantId", "warehouseId") IN (${Prisma.join(
        pairs.map((p) => Prisma.sql`(${p.variantId}::uuid, ${p.warehouseId}::uuid)`),
      )})
      ORDER BY "variantId", "warehouseId"
      FOR UPDATE
    `;

    return new Map(rows.map((row) => [levelKey(row), row]));
  }

  async readLevels(tx: PrismaTx, keys: LevelKey[]): Promise<Map<string, LockedLevel>> {
    if (keys.length === 0) return new Map();
    const rows = await tx.stockLevel.findMany({
      where: { OR: keys.map((k) => ({ variantId: k.variantId, warehouseId: k.warehouseId })) },
      select: {
        id: true,
        variantId: true,
        warehouseId: true,
        onHand: true,
        reserved: true,
        incoming: true,
        averageCost: true,
      },
    });
    return new Map(rows.map((row) => [levelKey(row), row]));
  }

  // -------------------------------------------------------------------------
  // Writing movements
  // -------------------------------------------------------------------------

  /**
   * Apply a plan produced by `resolveStockImpact`.
   * The plan decides *what* moves; this decides *how* it is recorded.
   */
  async applyPlan(
    tx: PrismaTx,
    plan: StockImpactPlan,
    options: ApplyOptions,
  ): Promise<string[]> {
    const type = options.movementType ?? movementTypeFor(plan.documentType);
    const movementIds: string[] = [];

    await this.lockLevels(tx, [
      ...plan.movements.map((m) => ({ variantId: m.variantId, warehouseId: m.warehouseId })),
      ...plan.reservations.map((r) => ({ variantId: r.variantId, warehouseId: r.warehouseId })),
    ]);

    // Reservations are released before the movement is written, so a delivery
    // consuming its order's hold does not momentarily look over-committed.
    for (const reservation of plan.reservations.filter((r) => r.action === 'RELEASE')) {
      await this.releaseReservation(tx, reservation);
    }

    for (const movement of plan.movements) {
      const id = await this.writeMovement(tx, {
        variantId: movement.variantId,
        warehouseId: movement.warehouseId,
        signedQuantity: movement.signedQuantity,
        type,
        unitCost: movement.unitCost,
        documentId: options.documentId ?? plan.documentId,
        documentLineId: movement.lineId,
      }, options.userId);
      movementIds.push(id);
    }

    for (const reservation of plan.reservations.filter((r) => r.action === 'HOLD')) {
      await this.holdReservation(tx, reservation, plan.documentId);
    }

    return movementIds;
  }

  /** Apply standalone movements: adjustments, transfers, counts, opening stock. */
  async applyMovements(
    tx: PrismaTx,
    inputs: MovementInput[],
    userId: string | null,
  ): Promise<string[]> {
    await this.lockLevels(tx, inputs);
    const ids: string[] = [];
    for (const input of inputs) {
      ids.push(await this.writeMovement(tx, input, userId));
    }
    return ids;
  }

  /**
   * The single primitive that touches stock: one append-only ledger row plus
   * the matching update to the cached level.
   *
   * Nothing else in the codebase may write `stock_movements` or `onHand`.
   */
  private async writeMovement(
    tx: PrismaTx,
    input: MovementInput,
    userId: string | null,
  ): Promise<string> {
    const levels = await this.readLevels(tx, [input]);
    const level = levels.get(levelKey(input));
    if (!level) {
      throw AppError.badRequest(
        'STOCK_LEVEL_MISSING',
        'Stock level row was not locked before writing a movement',
      );
    }

    const signed = dec(input.signedQuantity);
    if (signed.isZero()) {
      throw AppError.badRequest('ZERO_MOVEMENT', 'A stock movement cannot be zero');
    }

    const onHandBefore = dec(level.onHand);
    const onHandAfter = onHandBefore.plus(signed);
    const direction = signed.isNegative() ? StockDirection.OUT : StockDirection.IN;

    // Weighted average, recomputed only on inbound movements that carry a cost.
    // An outbound movement stamps the *current* average onto the ledger row, so
    // margin stays historically correct once the average moves on.
    let averageCostAfter = dec(level.averageCost);
    let stampedUnitCost = input.unitCost === null || input.unitCost === undefined
      ? null
      : dec(input.unitCost);

    if (direction === StockDirection.IN && stampedUnitCost) {
      const valueBefore = onHandBefore.gt(0)
        ? onHandBefore.times(averageCostAfter)
        : dec(0);
      const valueIn = signed.times(stampedUnitCost);
      const quantityBase = onHandBefore.gt(0) ? onHandBefore.plus(signed) : signed;
      averageCostAfter = quantityBase.gt(0)
        ? valueBefore.plus(valueIn).div(quantityBase)
        : stampedUnitCost;
    } else if (direction === StockDirection.OUT) {
      stampedUnitCost = averageCostAfter;
    }

    const movement = await tx.stockMovement.create({
      data: {
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        quantity: toPrismaDecimal(signed),
        direction,
        type: input.type,
        reason: input.reason ?? null,
        unitCost: toPrismaDecimalOrNull(stampedUnitCost),
        balanceAfter: toPrismaDecimal(onHandAfter),
        averageCostAfter: toPrismaDecimal(averageCostAfter),
        documentId: input.documentId ?? null,
        documentLineId: input.documentLineId ?? null,
        countLineId: input.countLineId ?? null,
        transferLineId: input.transferLineId ?? null,
        reversesMovementId: input.reversesMovementId ?? null,
        note: input.note ?? null,
        userId,
      },
      select: { id: true },
    });

    await tx.stockLevel.update({
      where: { id: level.id },
      data: {
        onHand: toPrismaDecimal(onHandAfter),
        averageCost: toPrismaDecimal(averageCostAfter),
      },
    });

    await syncLots(tx, input, movement.id, signed);

    return movement.id;
  }

  // -------------------------------------------------------------------------
  // Reservations
  // -------------------------------------------------------------------------

  private async holdReservation(
    tx: PrismaTx,
    reservation: PlannedReservation,
    documentId: string,
  ): Promise<void> {
    await tx.stockReservation.create({
      data: {
        variantId: reservation.variantId,
        warehouseId: reservation.warehouseId,
        quantity: toPrismaDecimal(reservation.quantity),
        direction: reservation.direction as StockDirection,
        documentId,
        documentLineId: reservation.lineId,
      },
    });

    // An outbound hold reduces availability; an inbound one is an expectation.
    const field = reservation.direction === 'OUT' ? 'reserved' : 'incoming';
    await tx.stockLevel.updateMany({
      where: { variantId: reservation.variantId, warehouseId: reservation.warehouseId },
      data: { [field]: { increment: toPrismaDecimal(reservation.quantity) } },
    });
  }

  /**
   * Consume an upstream order's hold.
   *
   * Releases across the order line's active reservations oldest-first, and
   * never more than was actually held: a quantity bumped up on the delivery
   * note must not release a hold that was never placed.
   */
  private async releaseReservation(
    tx: PrismaTx,
    reservation: PlannedReservation,
  ): Promise<void> {
    if (!reservation.sourceLineId) return;

    const active = await tx.stockReservation.findMany({
      where: {
        documentLineId: reservation.sourceLineId,
        status: 'ACTIVE',
        direction: reservation.direction as StockDirection,
      },
      orderBy: { createdAt: 'asc' },
    });

    let remaining = dec(reservation.quantity);
    const field = reservation.direction === 'OUT' ? 'reserved' : 'incoming';

    for (const row of active) {
      if (remaining.lte(0)) break;

      const outstanding = dec(row.quantity).minus(dec(row.releasedQuantity));
      if (outstanding.lte(0)) continue;

      const take = outstanding.lte(remaining) ? outstanding : remaining;
      const releasedTotal = dec(row.releasedQuantity).plus(take);
      const fullyReleased = releasedTotal.gte(dec(row.quantity));

      await tx.stockReservation.update({
        where: { id: row.id },
        data: {
          releasedQuantity: toPrismaDecimal(releasedTotal),
          status: fullyReleased ? 'RELEASED' : 'ACTIVE',
          releasedAt: fullyReleased ? new Date() : null,
        },
      });

      await tx.stockLevel.updateMany({
        where: { variantId: row.variantId, warehouseId: row.warehouseId },
        data: { [field]: { decrement: toPrismaDecimal(take) } },
      });

      remaining = remaining.minus(take);
    }
  }

  /** Cancel every outstanding hold a document placed, used when it is cancelled. */
  async cancelReservationsForDocument(tx: PrismaTx, documentId: string): Promise<void> {
    const active = await tx.stockReservation.findMany({
      where: { documentId, status: 'ACTIVE' },
    });

    for (const row of active) {
      const outstanding = dec(row.quantity).minus(dec(row.releasedQuantity));
      const field = row.direction === StockDirection.OUT ? 'reserved' : 'incoming';

      await tx.stockReservation.update({
        where: { id: row.id },
        data: { status: 'CANCELLED', releasedAt: new Date() },
      });

      if (outstanding.gt(0)) {
        await tx.stockLevel.updateMany({
          where: { variantId: row.variantId, warehouseId: row.warehouseId },
          data: { [field]: { decrement: toPrismaDecimal(outstanding) } },
        });
      }
    }
  }
}

export function levelKey(key: LevelKey): string {
  return `${key.variantId}::${key.warehouseId}`;
}

/** How a document's movements are labelled in the ledger. */
export function movementTypeFor(type: DocumentType | PrismaDocumentType): MovementType {
  switch (type) {
    case 'DELIVERY_NOTE':
    case 'SALES_INVOICE':
      return MovementType.SALE;
    case 'CREDIT_NOTE':
      return MovementType.SALE_RETURN;
    case 'GOODS_RECEIPT':
    case 'PURCHASE_INVOICE':
      return MovementType.PURCHASE;
    default:
      return MovementType.ADJUSTMENT;
  }
}
