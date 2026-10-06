import { Injectable } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { availableQuantity, dec } from '@mizmar/core';
import type { inventorySchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { decodeCursor, toPage, type Page } from '../common/util/cursor';
import { moneyOut, nullableQtyOut, qtyOut, toPrismaDecimal } from '../common/util/decimal';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { StockService, type MovementInput } from './stock.service';

type Warehouse = z.infer<typeof inventorySchemas.warehouse>;
type StockRow = z.infer<typeof inventorySchemas.stockRow>;
type StockListQuery = z.infer<typeof inventorySchemas.stockListQuery>;
type MovementRow = z.infer<typeof inventorySchemas.movementRow>;
type MovementListQuery = z.infer<typeof inventorySchemas.movementListQuery>;
type AdjustmentRequest = z.infer<typeof inventorySchemas.adjustmentRequest>;
type TransferRequest = z.infer<typeof inventorySchemas.transferRequest>;
type CountSession = z.infer<typeof inventorySchemas.countSession>;
type CountSessionCreate = z.infer<typeof inventorySchemas.countSessionCreate>;
type CountSubmitRequest = z.infer<typeof inventorySchemas.countSubmitRequest>;
type AvailabilityRow = z.infer<typeof inventorySchemas.availabilityRow>;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  // =========================================================================
  // Warehouses
  // =========================================================================

  async listWarehouses(ctx: RequestContext): Promise<Warehouse[]> {
    const rows = await this.prisma.warehouse.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { code: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      address: row.address,
      city: row.city,
      isActive: row.isActive,
    }));
  }

  async createWarehouse(
    ctx: RequestContext,
    body: { code: string; name: string; address?: string; city?: string },
  ): Promise<Warehouse> {
    this.assert(ctx, 'create', 'Warehouse');
    const row = await this.prisma.warehouse.create({
      data: {
        organizationId: ctx.organizationId,
        code: body.code.toUpperCase(),
        name: body.name,
        address: body.address ?? null,
        city: body.city ?? null,
      },
    });
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      address: row.address,
      city: row.city,
      isActive: row.isActive,
    };
  }

  async updateWarehouse(
    ctx: RequestContext,
    id: string,
    body: { code?: string; name?: string; address?: string; city?: string; isActive?: boolean },
  ): Promise<Warehouse> {
    this.assert(ctx, 'update', 'Warehouse');
    await this.assertWarehouse(ctx, id);
    const row = await this.prisma.warehouse.update({
      where: { id },
      data: {
        ...(body.code ? { code: body.code.toUpperCase() } : {}),
        ...(body.name ? { name: body.name } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      address: row.address,
      city: row.city,
      isActive: row.isActive,
    };
  }

  // =========================================================================
  // Stock dashboard
  // =========================================================================

  async listStock(ctx: RequestContext, query: StockListQuery): Promise<Page<StockRow>> {
    const cursor = decodeCursor(query.cursor);
    // Cost is hidden from roles that may not see it, rather than returned and
    // relied on being ignored by the UI.
    const maySeeCost = ctx.ability.can('read', 'ProductVariant', 'averageCost');

    const where: Prisma.StockLevelWhereInput = {
      warehouse: { organizationId: ctx.organizationId },
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.filter === 'zero' ? { onHand: { equals: 0 } } : {}),
      ...(query.filter === 'negative' ? { onHand: { lt: 0 } } : {}),
      variant: {
        isActive: true,
        ...(query.search
          ? {
              OR: [
                { sku: { contains: query.search, mode: 'insensitive' } },
                { barcode: { contains: query.search, mode: 'insensitive' } },
                { variantLabel: { contains: query.search, mode: 'insensitive' } },
                { product: { name: { contains: query.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
        ...(query.category ? { product: { category: query.category } } : {}),
      },
      ...(cursor
        ? {
            OR: [
              { variantId: { gt: cursor.value } },
              { variantId: cursor.value, id: { gt: cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.stockLevel.findMany({
      where,
      orderBy: [{ variantId: 'asc' }, { id: 'asc' }],
      // "Below threshold" compares two columns, which Prisma cannot express in
      // a filter, so it is applied after the fetch and the window is widened.
      take: query.filter === 'low' ? (query.limit + 1) * 4 : query.limit + 1,
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        variant: {
          select: {
            id: true,
            sku: true,
            barcode: true,
            variantLabel: true,
            minStockThreshold: true,
            product: { select: { id: true, name: true } },
          },
        },
      },
    });

    const mapped = rows
      .map((row) => {
        const onHand = dec(row.onHand.toFixed());
        const reserved = dec(row.reserved.toFixed());
        const threshold = dec(row.variant.minStockThreshold.toFixed());
        const available = onHand.minus(reserved);

        return {
          __cursorValue: row.variantId,
          __id: row.id,
          variantId: row.variantId,
          productId: row.variant.product.id,
          productName: row.variant.product.name,
          sku: row.variant.sku,
          barcode: row.variant.barcode,
          variantLabel: row.variant.variantLabel,
          warehouseId: row.warehouseId,
          warehouseCode: row.warehouse.code,
          warehouseName: row.warehouse.name,
          onHand: qtyOut(onHand),
          reserved: qtyOut(reserved),
          available: qtyOut(available),
          incoming: qtyOut(row.incoming),
          minStockThreshold: qtyOut(threshold),
          isLowStock: available.lte(threshold),
          lastMovementAt: null as string | null,
          ...(maySeeCost
            ? {
                averageCost: qtyOut(row.averageCost),
                stockValue: moneyOut(onHand.times(dec(row.averageCost.toFixed()))),
              }
            : {}),
        };
      })
      .filter((row) => (query.filter === 'low' ? row.isLowStock : true));

    const page = toPage(mapped, query.limit, (row) => ({
      value: row.__cursorValue,
      id: row.__id,
    }));

    return {
      nextCursor: page.nextCursor,
      items: page.items.map(({ __cursorValue: _c, __id: _i, ...row }) => row),
    };
  }

  async availability(
    ctx: RequestContext,
    body: { variantIds: string[]; warehouseId?: string },
  ): Promise<AvailabilityRow[]> {
    const rows = await this.prisma.stockLevel.findMany({
      where: {
        variantId: { in: body.variantIds },
        warehouse: { organizationId: ctx.organizationId },
        ...(body.warehouseId ? { warehouseId: body.warehouseId } : {}),
      },
      select: { variantId: true, warehouseId: true, onHand: true, reserved: true },
    });

    return rows.map((row) => ({
      variantId: row.variantId,
      warehouseId: row.warehouseId,
      onHand: qtyOut(row.onHand),
      reserved: qtyOut(row.reserved),
      available: availableQuantity(row.onHand.toFixed(), row.reserved.toFixed()),
    }));
  }

  // =========================================================================
  // Movement log — the stock audit trail
  // =========================================================================

  async listMovements(
    ctx: RequestContext,
    query: MovementListQuery,
  ): Promise<Page<MovementRow>> {
    const cursor = decodeCursor(query.cursor);

    const rows = await this.prisma.stockMovement.findMany({
      where: {
        warehouse: { organizationId: ctx.organizationId },
        ...(query.variantId ? { variantId: query.variantId } : {}),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.documentId ? { documentId: query.documentId } : {}),
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.value) } },
                { createdAt: new Date(cursor.value), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: {
        warehouse: { select: { code: true } },
        variant: {
          select: { sku: true, variantLabel: true, product: { select: { name: true } } },
        },
        document: { select: { type: true, number: true } },
        user: { select: { fullName: true } },
      },
    });

    const mapped = rows.map((row) => ({
      __cursorValue: row.createdAt.toISOString(),
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      variantId: row.variantId,
      sku: row.variant.sku,
      productName: row.variant.product.name,
      variantLabel: row.variant.variantLabel,
      warehouseId: row.warehouseId,
      warehouseCode: row.warehouse.code,
      type: row.type,
      direction: row.direction,
      reason: row.reason,
      quantity: qtyOut(row.quantity),
      balanceAfter: qtyOut(row.balanceAfter),
      unitCost: nullableQtyOut(row.unitCost),
      documentId: row.documentId,
      documentType: row.document?.type ?? null,
      documentNumber: row.document?.number ?? null,
      userId: row.userId,
      userName: row.user?.fullName ?? null,
      note: row.note,
    }));

    const page = toPage(mapped, query.limit, (row) => ({
      value: row.__cursorValue,
      id: row.id,
    }));

    return {
      nextCursor: page.nextCursor,
      items: page.items.map(({ __cursorValue: _c, ...row }) => row),
    };
  }

  // =========================================================================
  // Adjustments and transfers
  // =========================================================================

  /**
   * Manual adjustment.
   *
   * The payload carries signed *deltas*, not target quantities: an absolute
   * target computed from a screen the user opened five minutes ago would
   * silently discard every sale made since.
   */
  async adjust(ctx: RequestContext, body: AdjustmentRequest): Promise<MovementRow[]> {
    this.assert(ctx, 'create', 'StockAdjustment');
    await this.assertWarehouse(ctx, body.warehouseId);
    await this.assertVariants(ctx, body.lines.map((line) => line.variantId));

    const inputs: MovementInput[] = body.lines
      .filter((line) => !dec(line.quantityDelta).isZero())
      .map((line) => ({
        variantId: line.variantId,
        warehouseId: body.warehouseId,
        signedQuantity: dec(line.quantityDelta).toFixed(),
        type: MovementType.ADJUSTMENT,
        reason: body.reason,
        unitCost: line.unitCost ?? null,
        note: body.note ?? null,
      }));

    if (inputs.length === 0) {
      throw AppError.badRequest('NOTHING_TO_ADJUST', 'Every line had a zero quantity');
    }

    const ids = await this.prisma.$transaction((tx) =>
      this.stock.applyMovements(tx, inputs, ctx.userId),
    );
    return this.movementsByIds(ctx, ids);
  }

  /**
   * Transfer between warehouses: two ledger rows in one transaction.
   *
   * The destination receives at the source's current average cost, so moving
   * goods never invents or destroys inventory value.
   */
  async transfer(ctx: RequestContext, body: TransferRequest): Promise<MovementRow[]> {
    this.assert(ctx, 'create', 'StockTransfer');
    if (body.sourceWarehouseId === body.destinationWarehouseId) {
      throw AppError.badRequest('SAME_WAREHOUSE', 'Pick two different warehouses');
    }
    await this.assertWarehouse(ctx, body.sourceWarehouseId);
    await this.assertWarehouse(ctx, body.destinationWarehouseId);
    await this.assertVariants(ctx, body.lines.map((line) => line.variantId));

    const ids = await this.prisma.$transaction(async (tx) => {
      const reference = await this.nextReference(ctx.organizationId, 'TRF');

      const transfer = await tx.stockTransfer.create({
        data: {
          organizationId: ctx.organizationId,
          reference,
          sourceWarehouseId: body.sourceWarehouseId,
          destinationWarehouseId: body.destinationWarehouseId,
          status: 'RECEIVED',
          note: body.note ?? null,
          shippedAt: new Date(),
          receivedAt: new Date(),
          lines: {
            create: body.lines.map((line) => ({
              variantId: line.variantId,
              quantity: toPrismaDecimal(line.quantity),
            })),
          },
        },
        include: { lines: true },
      });

      const sourceLevels = await this.stock.lockLevels(
        tx,
        transfer.lines.map((line) => ({
          variantId: line.variantId,
          warehouseId: body.sourceWarehouseId,
        })),
      );

      const inputs: MovementInput[] = [];
      for (const line of transfer.lines) {
        const level = sourceLevels.get(`${line.variantId}::${body.sourceWarehouseId}`);
        const unitCost = level ? level.averageCost.toFixed() : null;

        inputs.push({
          variantId: line.variantId,
          warehouseId: body.sourceWarehouseId,
          signedQuantity: dec(line.quantity.toFixed()).negated().toFixed(),
          type: MovementType.TRANSFER_OUT,
          transferLineId: line.id,
          note: reference,
        });
        inputs.push({
          variantId: line.variantId,
          warehouseId: body.destinationWarehouseId,
          signedQuantity: line.quantity.toFixed(),
          type: MovementType.TRANSFER_IN,
          unitCost,
          transferLineId: line.id,
          note: reference,
        });
      }

      return this.stock.applyMovements(tx, inputs, ctx.userId);
    });

    return this.movementsByIds(ctx, ids);
  }

  // =========================================================================
  // Count sessions
  // =========================================================================

  async listCountSessions(
    ctx: RequestContext,
    query: { warehouseId?: string; status?: string },
  ): Promise<CountSession[]> {
    const sessions = await this.prisma.stockCountSession.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.status ? { status: query.status as never } : {}),
      },
      orderBy: { startedAt: 'desc' },
      include: countSessionInclude,
    });
    return sessions.map((session) => this.mapCountSession(session));
  }

  async createCountSession(
    ctx: RequestContext,
    body: CountSessionCreate,
  ): Promise<CountSession> {
    this.assert(ctx, 'create', 'StockCount');
    await this.assertWarehouse(ctx, body.warehouseId);

    const session = await this.prisma.$transaction(async (tx) => {
      // Snapshot what the system believes right now; the variance is measured
      // against this, not against the level at posting time.
      const levels = await tx.stockLevel.findMany({
        where: {
          warehouseId: body.warehouseId,
          variant: { isActive: true },
          ...(body.variantIds?.length ? { variantId: { in: body.variantIds } } : {}),
        },
        select: { variantId: true, onHand: true },
      });

      if (levels.length === 0) {
        throw AppError.badRequest(
          'NOTHING_TO_COUNT',
          'This warehouse has no stock records to count yet',
        );
      }

      return tx.stockCountSession.create({
        data: {
          organizationId: ctx.organizationId,
          warehouseId: body.warehouseId,
          reference: await this.nextReference(ctx.organizationId, 'CNT'),
          isBlind: body.isBlind,
          note: body.note ?? null,
          status: 'COUNTING',
          startedById: ctx.userId,
          lines: {
            create: levels.map((level) => ({
              variantId: level.variantId,
              expectedQuantity: level.onHand,
            })),
          },
        },
        include: countSessionInclude,
      });
    });

    return this.mapCountSession(session);
  }

  async getCountSession(ctx: RequestContext, id: string): Promise<CountSession> {
    const session = await this.prisma.stockCountSession.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: countSessionInclude,
    });
    if (!session) throw AppError.notFound('Count session', id);
    return this.mapCountSession(session);
  }

  async submitCount(
    ctx: RequestContext,
    id: string,
    body: CountSubmitRequest,
  ): Promise<CountSession> {
    this.assert(ctx, 'update', 'StockCount');
    const existing = await this.prisma.stockCountSession.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!existing) throw AppError.notFound('Count session', id);
    if (existing.status === 'POSTED' || existing.status === 'ABANDONED') {
      throw AppError.conflict('COUNT_CLOSED', 'This count session is closed');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const line of body.lines) {
        await tx.stockCountLine.updateMany({
          where: { sessionId: id, variantId: line.variantId },
          data: {
            countedQuantity: toPrismaDecimal(line.countedQuantity),
            note: line.note ?? null,
            countedAt: new Date(),
          },
        });
      }
      await tx.stockCountSession.update({ where: { id }, data: { status: 'REVIEW' } });
    });

    return this.getCountSession(ctx, id);
  }

  /**
   * Post the approved variances as COUNT_CORRECTION ledger rows.
   *
   * The delta is measured against the level *now*, not against the snapshot
   * taken when the session opened: the counter counted what is physically on
   * the shelf, and that is the number the system must end up agreeing with.
   */
  async postCount(ctx: RequestContext, id: string, note?: string): Promise<CountSession> {
    this.assert(ctx, 'update', 'StockCount');

    await this.prisma.$transaction(async (tx) => {
      const session = await tx.stockCountSession.findFirst({
        where: { id, organizationId: ctx.organizationId },
        include: { lines: true },
      });
      if (!session) throw AppError.notFound('Count session', id);
      if (session.status === 'POSTED') {
        throw AppError.conflict('ALREADY_POSTED', 'This count has already been posted');
      }

      const counted = session.lines.filter((line) => line.countedQuantity !== null);
      if (counted.length === 0) {
        throw AppError.badRequest('NOTHING_COUNTED', 'No line has been counted yet');
      }

      const levels = await this.stock.lockLevels(
        tx,
        counted.map((line) => ({
          variantId: line.variantId,
          warehouseId: session.warehouseId,
        })),
      );

      const inputs: MovementInput[] = [];
      for (const line of counted) {
        const level = levels.get(`${line.variantId}::${session.warehouseId}`);
        const onHand = dec(level?.onHand.toFixed() ?? 0);
        const delta = dec(line.countedQuantity!.toFixed()).minus(onHand);
        if (delta.isZero()) continue;

        inputs.push({
          variantId: line.variantId,
          warehouseId: session.warehouseId,
          signedQuantity: delta.toFixed(),
          type: MovementType.COUNT_CORRECTION,
          reason: 'COUNT_VARIANCE',
          countLineId: line.id,
          note: note ?? session.reference,
        });
      }

      if (inputs.length > 0) {
        await this.stock.applyMovements(tx, inputs, ctx.userId);
      }

      await tx.stockCountSession.update({
        where: { id },
        data: { status: 'POSTED', postedAt: new Date(), note: note ?? session.note },
      });
    });

    return this.getCountSession(ctx, id);
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private assert(
    ctx: RequestContext,
    action: 'create' | 'update' | 'read' | 'delete',
    what: 'Warehouse' | 'StockAdjustment' | 'StockTransfer' | 'StockCount',
  ): void {
    if (!ctx.ability.can(action, what)) {
      throw AppError.forbidden(`Your role may not ${action} ${what}`);
    }
  }

  private async assertWarehouse(ctx: RequestContext, warehouseId: string): Promise<void> {
    const found = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!found) throw AppError.notFound('Warehouse', warehouseId);
  }

  private async assertVariants(ctx: RequestContext, variantIds: string[]): Promise<void> {
    const unique = [...new Set(variantIds)];
    const count = await this.prisma.productVariant.count({
      where: { id: { in: unique }, product: { organizationId: ctx.organizationId } },
    });
    if (count !== unique.length) {
      throw AppError.notFound('One or more product variants');
    }
  }

  /** Read back the rows just written, so the caller sees the real ledger. */
  private async movementsByIds(ctx: RequestContext, ids: string[]): Promise<MovementRow[]> {
    if (ids.length === 0) return [];

    const rows = await this.prisma.stockMovement.findMany({
      where: { id: { in: ids }, warehouse: { organizationId: ctx.organizationId } },
      orderBy: { createdAt: 'asc' },
      include: {
        warehouse: { select: { code: true } },
        variant: {
          select: { sku: true, variantLabel: true, product: { select: { name: true } } },
        },
        document: { select: { type: true, number: true } },
        user: { select: { fullName: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      variantId: row.variantId,
      sku: row.variant.sku,
      productName: row.variant.product.name,
      variantLabel: row.variant.variantLabel,
      warehouseId: row.warehouseId,
      warehouseCode: row.warehouse.code,
      type: row.type,
      direction: row.direction,
      reason: row.reason,
      quantity: qtyOut(row.quantity),
      balanceAfter: qtyOut(row.balanceAfter),
      unitCost: nullableQtyOut(row.unitCost),
      documentId: row.documentId,
      documentType: row.document?.type ?? null,
      documentNumber: row.document?.number ?? null,
      userId: row.userId,
      userName: row.user?.fullName ?? null,
      note: row.note,
    }));
  }

  /** Sequential human-readable reference, e.g. TRF-000004. */
  private async nextReference(organizationId: string, prefix: 'TRF' | 'CNT'): Promise<string> {
    const count =
      prefix === 'TRF'
        ? await this.prisma.stockTransfer.count({ where: { organizationId } })
        : await this.prisma.stockCountSession.count({ where: { organizationId } });
    return `${prefix}-${String(count + 1).padStart(6, '0')}`;
  }

  private mapCountSession(
    session: Prisma.StockCountSessionGetPayload<{ include: typeof countSessionInclude }>,
  ): CountSession {
    // A blind count hides the expected quantity until the session is reviewed,
    // so the counter records what is on the shelf rather than what is expected.
    const hideExpected = session.isBlind && session.status === 'COUNTING';

    const lines = session.lines.map((line) => {
      const expected = dec(line.expectedQuantity.toFixed());
      const counted = line.countedQuantity ? dec(line.countedQuantity.toFixed()) : null;

      return {
        id: line.id,
        variantId: line.variantId,
        sku: line.variant.sku,
        productName: line.variant.product.name,
        variantLabel: line.variant.variantLabel,
        expectedQuantity: hideExpected ? null : qtyOut(expected),
        countedQuantity: counted ? qtyOut(counted) : null,
        variance: counted && !hideExpected ? qtyOut(counted.minus(expected)) : null,
        note: line.note,
        countedAt: line.countedAt?.toISOString() ?? null,
      };
    });

    return {
      id: session.id,
      reference: session.reference,
      warehouseId: session.warehouseId,
      warehouseName: session.warehouse.name,
      isBlind: session.isBlind,
      status: session.status,
      note: session.note,
      startedAt: session.startedAt.toISOString(),
      postedAt: session.postedAt?.toISOString() ?? null,
      startedByName: session.startedBy?.fullName ?? null,
      lines,
      varianceCount: lines.filter((line) => line.variance && !dec(line.variance).isZero()).length,
    };
  }
}

const countSessionInclude = {
  warehouse: { select: { name: true } },
  startedBy: { select: { fullName: true } },
  lines: {
    orderBy: { variant: { sku: 'asc' } },
    include: {
      variant: { select: { sku: true, variantLabel: true, product: { select: { name: true } } } },
    },
  },
} satisfies Prisma.StockCountSessionInclude;
