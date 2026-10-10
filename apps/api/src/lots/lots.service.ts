import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec } from '@mizmar/core';
import type { lotSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { moneyOut } from '../common/util/decimal';
import { addToLot } from '../inventory/lots';
import { StockService } from '../inventory/stock.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { nextInternalEan13 } from './ean13';

type Query = z.infer<typeof lotSchemas.lotsQuery>;
type LotItem = z.infer<typeof lotSchemas.lotItem>;
type ListResponse = z.infer<typeof lotSchemas.lotsResponse>;
type Unassigned = z.infer<typeof lotSchemas.unassignedItem>;
type Tracked = z.infer<typeof lotSchemas.trackedVariant>;
type Assign = z.infer<typeof lotSchemas.assignBody>;
type Patch = z.infer<typeof lotSchemas.lotPatch>;
type WriteOff = z.infer<typeof lotSchemas.writeOffBody>;
type Trace = z.infer<typeof lotSchemas.traceItem>;

const DAY = 24 * 60 * 60 * 1000;
const iso = (date: Date) => date.toISOString().slice(0, 10);

const lotInclude = {
  variant: { select: { sku: true, variantLabel: true, tracking: true, product: { select: { name: true } } } },
  warehouse: { select: { name: true } },
} satisfies Prisma.StockLotInclude;

type LotRow = Prisma.StockLotGetPayload<{ include: typeof lotInclude }>;

@Injectable()
export class LotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  // ----- lots --------------------------------------------------------------

  async list(ctx: RequestContext, query: Query): Promise<ListResponse> {
    this.assertCan(ctx, 'read');
    const today = startOfToday();
    const horizon = new Date(today.getTime() + query.days * DAY);

    const rows = await this.prisma.stockLot.findMany({
      where: {
        variant: { product: { organizationId: ctx.organizationId } },
        warehouse: { organizationId: ctx.organizationId },
        quantity: { gt: 0 },
        ...(query.variantId ? { variantId: query.variantId } : {}),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.filter === 'expired' ? { expiryDate: { lt: today } } : {}),
        ...(query.filter === 'expiring' ? { expiryDate: { lte: horizon } } : {}),
        ...(query.search
          ? {
              OR: [
                { lotNumber: { contains: query.search, mode: 'insensitive' } },
                { variant: { sku: { contains: query.search, mode: 'insensitive' } } },
                { variant: { product: { name: { contains: query.search, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      include: lotInclude,
      orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
      take: 1000,
    });

    const costs = await this.averageCosts(rows);
    const items = rows.map((row) => mapLot(row, costs, today));

    const empty = () => ({ count: 0, quantity: dec(0), value: dec(0) });
    const summary = { expired: empty(), within30: empty(), within60: empty(), within90: empty() };
    for (const item of items) {
      if (item.daysToExpiry === null) continue;
      const bucket =
        item.daysToExpiry < 0 ? 'expired' : item.daysToExpiry <= 30 ? 'within30' : item.daysToExpiry <= 60 ? 'within60' : item.daysToExpiry <= 90 ? 'within90' : null;
      if (!bucket) continue;
      summary[bucket].count += 1;
      summary[bucket].quantity = summary[bucket].quantity.plus(item.quantity);
      summary[bucket].value = summary[bucket].value.plus(item.stockValue);
    }
    const out = (b: ReturnType<typeof empty>) => ({ count: b.count, quantity: moneyOutQty(b.quantity), value: moneyOut(b.value) });

    return {
      items,
      summary: { expired: out(summary.expired), within30: out(summary.within30), within60: out(summary.within60), within90: out(summary.within90) },
    };
  }

  /** Tracked stock that no lot accounts for yet. */
  async unassigned(ctx: RequestContext): Promise<Unassigned[]> {
    this.assertCan(ctx, 'read');
    const levels = await this.prisma.stockLevel.findMany({
      where: {
        onHand: { gt: 0 },
        variant: { tracking: { not: 'NONE' }, product: { organizationId: ctx.organizationId } },
        warehouse: { organizationId: ctx.organizationId },
      },
      include: {
        variant: { select: { sku: true, variantLabel: true, tracking: true, product: { select: { name: true } } } },
        warehouse: { select: { name: true } },
      },
    });
    if (levels.length === 0) return [];

    const sums = await this.prisma.stockLot.groupBy({
      by: ['variantId', 'warehouseId'],
      where: { variantId: { in: levels.map((level) => level.variantId) } },
      _sum: { quantity: true },
    });
    const assigned = new Map(sums.map((row) => [`${row.variantId}::${row.warehouseId}`, dec((row._sum.quantity ?? 0).toString())]));

    return levels
      .map((level): Unassigned => {
        const done = assigned.get(`${level.variantId}::${level.warehouseId}`) ?? dec(0);
        const left = dec(level.onHand.toFixed()).minus(done);
        return {
          variantId: level.variantId,
          productName: level.variant.product.name,
          sku: level.variant.sku,
          variantLabel: level.variant.variantLabel,
          tracking: level.variant.tracking,
          warehouseId: level.warehouseId,
          warehouseName: level.warehouse.name,
          onHand: moneyOutQty(dec(level.onHand.toFixed())),
          assigned: moneyOutQty(done),
          unassigned: moneyOutQty(left.isNegative() ? dec(0) : left),
        };
      })
      .filter((item) => dec(item.unassigned).gt(0))
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }

  async tracked(ctx: RequestContext, query: z.infer<typeof lotSchemas.trackedQuery>): Promise<Tracked[]> {
    this.assertCan(ctx, 'read');
    const variants = await this.prisma.productVariant.findMany({
      where: {
        product: { organizationId: ctx.organizationId, isService: false },
        isActive: true,
        ...(query.trackedOnly ? { tracking: { not: 'NONE' } } : {}),
        ...(query.search
          ? {
              OR: [
                { sku: { contains: query.search, mode: 'insensitive' } },
                { barcode: { contains: query.search, mode: 'insensitive' } },
                { product: { name: { contains: query.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        sku: true,
        barcode: true,
        variantLabel: true,
        tracking: true,
        product: { select: { name: true } },
        stockLevels: { select: { onHand: true } },
      },
      orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
      take: 100,
    });
    return variants.map((variant) => ({
      variantId: variant.id,
      productName: variant.product.name,
      sku: variant.sku,
      variantLabel: variant.variantLabel,
      barcode: variant.barcode,
      tracking: variant.tracking,
      onHand: moneyOutQty(variant.stockLevels.reduce((sum, level) => sum.plus(level.onHand.toFixed()), dec(0))),
    }));
  }

  async setTracking(ctx: RequestContext, body: z.infer<typeof lotSchemas.setTrackingBody>): Promise<Tracked> {
    this.assertCan(ctx, 'update');
    const variant = await this.variantOrThrow(ctx, body.variantId);
    if (variant.product.isService) {
      throw AppError.unprocessable('SERVICE_NOT_TRACKABLE', 'A service has no stock to trace');
    }
    // Moving to SERIAL needs every existing lot to be a single unit.
    if (body.tracking === 'SERIAL') {
      const bulky = await this.prisma.stockLot.count({ where: { variantId: variant.id, quantity: { gt: 1 } } });
      if (bulky > 0) {
        throw AppError.unprocessable('LOTS_NOT_SERIAL', 'Some lots hold more than one unit; split them first');
      }
    }
    await this.prisma.productVariant.update({ where: { id: variant.id }, data: { tracking: body.tracking } });
    const [row] = await this.tracked(ctx, { search: variant.sku });
    const match = (await this.tracked(ctx, { search: variant.sku })).find((entry) => entry.variantId === variant.id) ?? row;
    return match!;
  }

  /** Attribute untracked on-hand stock to a lot, or to serial numbers. */
  async assign(ctx: RequestContext, body: Assign): Promise<LotItem[]> {
    this.assertCan(ctx, 'update');
    const variant = await this.variantOrThrow(ctx, body.variantId);
    await this.warehouseOrThrow(ctx, body.warehouseId);
    if (variant.tracking === 'NONE') {
      throw AppError.unprocessable('NOT_TRACKED', 'Switch tracking on for this item first');
    }

    const serials = (body.serials ?? []).map((s) => s.trim()).filter(Boolean);
    if (variant.tracking === 'SERIAL') {
      if (serials.length === 0) throw AppError.badRequest('SERIALS_REQUIRED', 'List the serial numbers, one per unit');
      if (new Set(serials.map((s) => s.toLowerCase())).size !== serials.length) {
        throw AppError.badRequest('DUPLICATE_SERIAL', 'A serial number appears twice');
      }
    } else if (!body.lotNumber || !body.quantity) {
      throw AppError.badRequest('LOT_REQUIRED', 'A lot number and quantity are required');
    }

    const quantity = variant.tracking === 'SERIAL' ? dec(serials.length) : dec(body.quantity!);
    if (quantity.lte(0)) throw AppError.badRequest('INVALID_QUANTITY', 'The quantity must be above zero');

    const ids = await this.prisma.$transaction(async (tx) => {
      const level = await tx.stockLevel.findUnique({
        where: { variantId_warehouseId: { variantId: body.variantId, warehouseId: body.warehouseId } },
      });
      const sum = await tx.stockLot.aggregate({
        where: { variantId: body.variantId, warehouseId: body.warehouseId },
        _sum: { quantity: true },
      });
      const free = dec((level?.onHand ?? 0).toString()).minus(dec((sum._sum.quantity ?? 0).toString()));
      if (quantity.gt(free)) {
        throw AppError.unprocessable('EXCEEDS_UNASSIGNED', `Only ${free.toFixed()} unit(s) are not yet assigned to a lot`, {
          unassigned: free.toFixed(),
        });
      }

      if (variant.tracking === 'SERIAL') {
        const taken = await tx.stockLot.findMany({
          where: { variantId: body.variantId, warehouseId: body.warehouseId, lotNumber: { in: serials }, quantity: { gt: 0 } },
          select: { lotNumber: true },
        });
        if (taken.length > 0) {
          throw AppError.conflict('SERIAL_EXISTS', `Serial number ${taken[0]!.lotNumber} is already in stock`);
        }
        const created: string[] = [];
        for (const serial of serials) {
          created.push(await addToLot(tx, body.variantId, body.warehouseId, null, { lotNumber: serial, expiryDate: body.expiryDate ?? null, quantity: '1' }));
        }
        return created;
      }
      return [await addToLot(tx, body.variantId, body.warehouseId, null, { lotNumber: body.lotNumber!, expiryDate: body.expiryDate ?? null, quantity: quantity.toFixed() })];
    });

    const rows = await this.prisma.stockLot.findMany({ where: { id: { in: ids } }, include: lotInclude });
    const costs = await this.averageCosts(rows);
    return rows.map((row) => mapLot(row, costs, startOfToday()));
  }

  async update(ctx: RequestContext, id: string, body: Patch): Promise<LotItem> {
    this.assertCan(ctx, 'update');
    const lot = await this.lotOrThrow(ctx, id);
    try {
      await this.prisma.stockLot.update({
        where: { id: lot.id },
        data: {
          ...(body.lotNumber !== undefined ? { lotNumber: body.lotNumber } : {}),
          ...(body.expiryDate !== undefined ? { expiryDate: body.expiryDate ? new Date(body.expiryDate) : null } : {}),
          ...(body.note !== undefined ? { note: body.note || null } : {}),
        },
      });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
        throw AppError.conflict('DUPLICATE_LOT', 'That lot number already exists for this item and warehouse');
      }
      throw cause;
    }
    return this.reloadItem(lot.id);
  }

  /** Remove units from one lot and from stock, with a reason (expired, damaged...). */
  async writeOff(ctx: RequestContext, id: string, body: WriteOff): Promise<LotItem> {
    this.assertCan(ctx, 'update');
    if (!ctx.ability.can('create', 'StockAdjustment')) throw AppError.forbidden('Your role may not adjust stock');
    const lot = await this.lotOrThrow(ctx, id);
    const quantity = dec(body.quantity);
    if (quantity.lte(0)) throw AppError.badRequest('INVALID_QUANTITY', 'The quantity must be above zero');
    if (quantity.gt(dec(lot.quantity.toFixed()))) {
      throw AppError.unprocessable('EXCEEDS_LOT', `The lot only holds ${lot.quantity.toFixed()}`);
    }

    await this.prisma.$transaction((tx) =>
      this.stock.applyMovements(
        tx,
        [
          {
            variantId: lot.variantId,
            warehouseId: lot.warehouseId,
            signedQuantity: quantity.negated().toFixed(),
            type: 'ADJUSTMENT',
            reason: body.reason,
            note: [`Lot ${lot.lotNumber}`, body.note].filter(Boolean).join(' — '),
            fromLotId: lot.id,
          },
        ],
        ctx.userId,
      ),
    );
    return this.reloadItem(lot.id);
  }

  /** Where a lot came from and where it went: the recall trail. */
  async trace(ctx: RequestContext, id: string): Promise<Trace[]> {
    this.assertCan(ctx, 'read');
    await this.lotOrThrow(ctx, id);
    const rows = await this.prisma.stockLotMovement.findMany({
      where: { lotId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        movement: {
          select: {
            type: true,
            note: true,
            createdAt: true,
            document: { select: { id: true, number: true, type: true, contact: { select: { displayName: true } } } },
          },
        },
      },
      take: 200,
    });
    return rows.map((row) => ({
      at: row.movement.createdAt.toISOString(),
      type: row.movement.type,
      quantity: moneyOutQty(dec(row.quantity.toFixed())),
      documentId: row.movement.document?.id ?? null,
      documentNumber: row.movement.document?.number ?? null,
      documentType: row.movement.document?.type ?? null,
      contactName: row.movement.document?.contact.displayName ?? null,
      note: row.movement.note,
    }));
  }

  // ----- barcodes ----------------------------------------------------------

  /** Give every listed variant that has no barcode an internal EAN-13. */
  async generateBarcodes(ctx: RequestContext, variantIds: string[]): Promise<Array<{ variantId: string; barcode: string }>> {
    this.assertCan(ctx, 'update');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'barcodes:' + ctx.organizationId}))`;

      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds }, barcode: null, product: { organizationId: ctx.organizationId } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      if (variants.length === 0) return [];

      const last = await tx.productVariant.findFirst({
        where: { barcode: { startsWith: '200' }, product: { organizationId: ctx.organizationId } },
        orderBy: { barcode: 'desc' },
        select: { barcode: true },
      });

      let code = last?.barcode ?? null;
      const assigned: Array<{ variantId: string; barcode: string }> = [];
      for (const variant of variants) {
        code = nextInternalEan13(code);
        await tx.productVariant.update({ where: { id: variant.id }, data: { barcode: code } });
        assigned.push({ variantId: variant.id, barcode: code });
      }
      return assigned;
    });
  }

  // ----- helpers -----------------------------------------------------------

  private async averageCosts(rows: Array<{ variantId: string; warehouseId: string }>) {
    if (rows.length === 0) return new Map<string, Prisma.Decimal>();
    const levels = await this.prisma.stockLevel.findMany({
      where: { variantId: { in: [...new Set(rows.map((r) => r.variantId))] } },
      select: { variantId: true, warehouseId: true, averageCost: true },
    });
    return new Map(levels.map((level) => [`${level.variantId}::${level.warehouseId}`, level.averageCost]));
  }

  private async reloadItem(id: string): Promise<LotItem> {
    const row = await this.prisma.stockLot.findUniqueOrThrow({ where: { id }, include: lotInclude });
    return mapLot(row, await this.averageCosts([row]), startOfToday());
  }

  private async lotOrThrow(ctx: RequestContext, id: string) {
    const lot = await this.prisma.stockLot.findFirst({
      where: { id, warehouse: { organizationId: ctx.organizationId } },
    });
    if (!lot) throw AppError.notFound('Lot', id);
    return lot;
  }

  private async variantOrThrow(ctx: RequestContext, id: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id, product: { organizationId: ctx.organizationId } },
      select: { id: true, sku: true, tracking: true, product: { select: { isService: true } } },
    });
    if (!variant) throw AppError.notFound('Item', id);
    return variant;
  }

  private async warehouseOrThrow(ctx: RequestContext, id: string) {
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!warehouse) throw AppError.notFound('Warehouse', id);
    return warehouse;
  }

  private assertCan(ctx: RequestContext, action: 'read' | 'update'): void {
    if (!ctx.ability.can(action, 'StockAdjustment') && !(action === 'read' && ctx.ability.can('read', 'Payment'))) {
      throw AppError.forbidden('Your role may not manage lots');
    }
  }
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function moneyOutQty(value: ReturnType<typeof dec>): string {
  return value.toFixed(6).replace(/\.?0+$/, '') || '0';
}

function mapLot(row: LotRow, costs: Map<string, Prisma.Decimal>, today: Date): LotItem {
  const cost = costs.get(`${row.variantId}::${row.warehouseId}`);
  return {
    id: row.id,
    variantId: row.variantId,
    productName: row.variant.product.name,
    sku: row.variant.sku,
    variantLabel: row.variant.variantLabel,
    tracking: row.variant.tracking,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    lotNumber: row.lotNumber,
    expiryDate: row.expiryDate ? iso(row.expiryDate) : null,
    quantity: moneyOutQty(dec(row.quantity.toFixed())),
    daysToExpiry: row.expiryDate ? Math.round((row.expiryDate.getTime() - today.getTime()) / DAY) : null,
    stockValue: moneyOut(dec(row.quantity.toFixed()).times(dec((cost ?? 0).toString()))),
    note: row.note,
  };
}

