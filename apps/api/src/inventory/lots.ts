import { Prisma } from '@prisma/client';
import { dec } from '@mizmar/core';
import { toPrismaDecimal } from '../common/util/decimal';
import type { PrismaTx } from '../prisma/prisma.service';

export interface LotCandidate {
  id: string;
  quantity: string;
  expiryDate: string | null;
  receivedAt: string;
}

export interface LotDraw {
  lotId: string;
  quantity: string;
}

/**
 * First-expired, first-out: which lots to draw from for `need` units.
 * Lots without an expiry date go last; ties go to the oldest receipt.
 * Draws only what the lots hold; any shortfall stays unassigned stock.
 */
export function planFefo(lots: LotCandidate[], need: string): LotDraw[] {
  const ordered = [...lots]
    .filter((lot) => dec(lot.quantity).gt(0))
    .sort((a, b) => {
      if (a.expiryDate !== b.expiryDate) {
        if (a.expiryDate === null) return 1;
        if (b.expiryDate === null) return -1;
        return a.expiryDate < b.expiryDate ? -1 : 1;
      }
      return a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0;
    });

  let remaining = dec(need);
  const draws: LotDraw[] = [];
  for (const lot of ordered) {
    if (remaining.lte(0)) break;
    const take = dec(lot.quantity).lt(remaining) ? dec(lot.quantity) : remaining;
    draws.push({ lotId: lot.id, quantity: take.toFixed() });
    remaining = remaining.minus(take);
  }
  return draws;
}

export interface LotMovementInput {
  variantId: string;
  warehouseId: string;
  type: string;
  transferLineId?: string | null;
  documentLineId?: string | null;
  reversesMovementId?: string | null;
  /** Lot to add the received units to. */
  lot?: { lotNumber: string; expiryDate?: string | null } | null;
  /** Draw from this lot only (a write-off), instead of first-expired. */
  fromLotId?: string | null;
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Keep lots in step with a stock movement that was just written. Variants that
 * are not tracked are skipped with a single lookup, so this is cheap for them.
 *
 *  - Out: draw from lots first-expired first (or the named lot).
 *  - In, reversing an earlier out: put the units back into the same lots.
 *  - In, as a transfer: arrive in the same lots as they left.
 *  - In, with a lot given: add to that lot.
 *  - Otherwise the units stay unassigned until someone attributes them.
 */
export async function syncLots(
  tx: PrismaTx,
  input: LotMovementInput,
  movementId: string,
  signed: Prisma.Decimal | ReturnType<typeof dec>,
): Promise<void> {
  const variant = await tx.productVariant.findUnique({
    where: { id: input.variantId },
    select: { tracking: true },
  });
  if (!variant || variant.tracking === 'NONE') return;

  const quantity = dec(signed.toString());

  if (quantity.isNegative()) {
    const need = quantity.abs().toFixed();
    const lots = await tx.stockLot.findMany({
      where: {
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        quantity: { gt: 0 },
        ...(input.fromLotId ? { id: input.fromLotId } : {}),
      },
      select: { id: true, quantity: true, expiryDate: true, receivedAt: true },
    });
    const draws = planFefo(
      lots.map((lot) => ({
        id: lot.id,
        quantity: lot.quantity.toFixed(),
        expiryDate: lot.expiryDate ? iso(lot.expiryDate) : null,
        receivedAt: lot.receivedAt.toISOString(),
      })),
      need,
    );
    for (const draw of draws) {
      await tx.stockLot.update({
        where: { id: draw.lotId },
        data: { quantity: { decrement: toPrismaDecimal(draw.quantity) } },
      });
      await tx.stockLotMovement.create({
        data: { lotId: draw.lotId, movementId, quantity: toPrismaDecimal(dec(draw.quantity).negated()) },
      });
    }
    return;
  }

  // Inbound.
  if (input.reversesMovementId) {
    const original = await tx.stockLotMovement.findMany({ where: { movementId: input.reversesMovementId } });
    for (const part of original) {
      const back = dec(part.quantity.toFixed()).abs();
      await tx.stockLot.update({ where: { id: part.lotId }, data: { quantity: { increment: toPrismaDecimal(back) } } });
      await tx.stockLotMovement.create({ data: { lotId: part.lotId, movementId, quantity: toPrismaDecimal(back) } });
    }
    return;
  }

  // A cancelled document gives back what its line drew, lot by lot.
  if (input.type === 'CANCELLATION' && input.documentLineId) {
    const parts = await tx.stockLotMovement.findMany({
      where: { movement: { documentLineId: input.documentLineId, variantId: input.variantId, warehouseId: input.warehouseId } },
      select: { lotId: true, quantity: true },
    });
    // Net per lot: draws are negative, earlier give-backs positive.
    const net = new Map<string, ReturnType<typeof dec>>();
    for (const part of parts) {
      net.set(part.lotId, (net.get(part.lotId) ?? dec(0)).plus(dec(part.quantity.toFixed())));
    }
    let remaining = quantity;
    for (const [lotId, balance] of net) {
      if (remaining.lte(0) || balance.gte(0)) continue;
      const back = balance.abs().lt(remaining) ? balance.abs() : remaining;
      await tx.stockLot.update({ where: { id: lotId }, data: { quantity: { increment: toPrismaDecimal(back) } } });
      await tx.stockLotMovement.create({ data: { lotId, movementId, quantity: toPrismaDecimal(back) } });
      remaining = remaining.minus(back);
    }
    return;
  }

  if (input.type === 'TRANSFER_IN' && input.transferLineId) {
    const out = await tx.stockMovement.findFirst({
      where: { transferLineId: input.transferLineId, type: 'TRANSFER_OUT', variantId: input.variantId },
      select: { lotMovements: { select: { quantity: true, lot: { select: { lotNumber: true, expiryDate: true } } } } },
    });
    for (const part of out?.lotMovements ?? []) {
      await addToLot(tx, input.variantId, input.warehouseId, movementId, {
        lotNumber: part.lot.lotNumber,
        expiryDate: part.lot.expiryDate ? iso(part.lot.expiryDate) : null,
        quantity: dec(part.quantity.toFixed()).abs().toFixed(),
      });
    }
    return;
  }

  if (input.lot) {
    await addToLot(tx, input.variantId, input.warehouseId, movementId, {
      lotNumber: input.lot.lotNumber,
      expiryDate: input.lot.expiryDate ?? null,
      quantity: quantity.toFixed(),
    });
  }
}

/** Add units to a lot, creating it on first use. */
export async function addToLot(
  tx: PrismaTx,
  variantId: string,
  warehouseId: string,
  movementId: string | null,
  input: { lotNumber: string; expiryDate: string | null; quantity: string },
): Promise<string> {
  const lot = await tx.stockLot.upsert({
    where: { variantId_warehouseId_lotNumber: { variantId, warehouseId, lotNumber: input.lotNumber } },
    create: {
      variantId,
      warehouseId,
      lotNumber: input.lotNumber,
      expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
      quantity: toPrismaDecimal(input.quantity),
    },
    update: {
      quantity: { increment: toPrismaDecimal(input.quantity) },
      ...(input.expiryDate ? { expiryDate: new Date(input.expiryDate) } : {}),
    },
  });
  if (movementId) {
    await tx.stockLotMovement.create({
      data: { lotId: lot.id, movementId, quantity: toPrismaDecimal(input.quantity) },
    });
  }
  return lot.id;
}
