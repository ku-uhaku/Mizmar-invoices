import { Injectable } from '@nestjs/common';
import {
  type Company,
  type DocumentType,
  Lifecycle,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  type AvailabilitySnapshot,
  checkAvailability,
  computeFulfilment,
  computeSettlement,
  computeTotals,
  conversionTargets,
  canCancel as coreCanCancel,
  dec,
  documentBadges,
  dueDateFrom,
  invertPlan,
  isLive,
  isOverdue,
  isSales,
  meta as documentMeta,
  planConversion,
  resolveStockImpact,
  subject,
  type ConversionSource,
  type ConvertibleLine,
  type Discount,
  type RoundingConfig,
  type StockImpactPlan,
  type TotalsInput,
} from '@mizmar/core';
import type { documentSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { decodeCursor, encodeCursor, toPage, type Page } from '../common/util/cursor';
import {
  moneyOut,
  qtyOut,
  rateOut,
  toPrismaDecimal,
  toPrismaDecimalOrNull,
} from '../common/util/decimal';
import { PrismaService, type PrismaTx } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { StockService, levelKey, movementTypeFor } from '../inventory/stock.service';
import { documentInclude, type DocumentWithRelations } from './document-include';
import { mapDocument, type AvailabilityIndex } from './document.mapper';
import { NumberingService } from './numbering.service';

type DocumentDetail = z.infer<typeof documentSchemas.documentDetail>;
type DocumentListRow = z.infer<typeof documentSchemas.documentListRow>;
type DocumentCreate = z.infer<typeof documentSchemas.documentCreate>;
type DocumentUpdate = z.infer<typeof documentSchemas.documentUpdate>;
type DocumentListQuery = z.infer<typeof documentSchemas.documentListQuery>;
type LineInput = z.infer<typeof documentSchemas.documentLineInput>;
type ValidationPreview = z.infer<typeof documentSchemas.validationPreview>;
type ConversionOptions = z.infer<typeof documentSchemas.conversionOptions>;
type ConvertRequest = z.infer<typeof documentSchemas.convertRequest>;
type TotalsPreviewRequest = z.infer<typeof documentSchemas.totalsPreviewRequest>;
type TotalsPreviewResponse = z.infer<typeof documentSchemas.totalsPreviewResponse>;

/** Company settings that govern money and stock behaviour on a document. */
interface CompanySettings {
  rounding: RoundingConfig;
  priceMode: 'EXCLUSIVE' | 'INCLUSIVE';
  negativeStockPolicy: 'BLOCK' | 'WARN' | 'ALLOW';
  defaultWarehouseId: string | null;
  defaultCurrency: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly numbering: NumberingService,
  ) {}

  // =========================================================================
  // Reads
  // =========================================================================

  async get(ctx: RequestContext, id: string): Promise<DocumentDetail> {
    const document = await this.loadDocument(this.prisma, ctx, id);
    this.assertCan(ctx, 'read', document);
    return mapDocument(document, { availability: await this.availabilityFor(document) });
  }

  async list(ctx: RequestContext, query: DocumentListQuery): Promise<Page<DocumentListRow>> {
    const cursor = decodeCursor(query.cursor);
    const now = new Date();

    const where: Prisma.DocumentWhereInput = {
      companyId: ctx.companyId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.side ? { side: query.side } : {}),
      ...(query.lifecycle ? { lifecycle: query.lifecycle } : {}),
      ...(query.settlement ? { settlement: query.settlement } : {}),
      ...(query.fulfilment ? { fulfilment: query.fulfilment } : {}),
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.createdById ? { createdById: query.createdById } : {}),
      ...(query.from || query.to
        ? {
            issueDate: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.minTotal || query.maxTotal
        ? {
            totalInclVat: {
              ...(query.minTotal ? { gte: toPrismaDecimal(query.minTotal) } : {}),
              ...(query.maxTotal ? { lte: toPrismaDecimal(query.maxTotal) } : {}),
            },
          }
        : {}),
      // Overdue is a function of the clock, so it is a filter, never a column.
      ...(query.overdueOnly
        ? {
            dueDate: { lt: now },
            settlement: { in: ['UNPAID', 'PARTIAL'] },
            lifecycle: { in: ['VALIDATED', 'SENT'] },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: 'insensitive' } },
              { reference: { contains: query.search, mode: 'insensitive' } },
              { projectName: { contains: query.search, mode: 'insensitive' } },
              { contact: { displayName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
      // A salesperson sees only the sales side, and the ability already says so;
      // mirroring it here keeps the SQL cheap instead of filtering after the fact.
      ...(ctx.role === 'SALES' ? { side: 'SALES' as const } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.value) } },
              { createdAt: new Date(cursor.value), id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.document.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: {
        contact: { select: { displayName: true } },
        createdBy: { select: { fullName: true } },
      },
    });

    const page = toPage(
      rows.map((row) => this.toListRow(row, now)),
      query.limit,
      (row) => ({ value: row.__cursorValue, id: row.id }),
    );

    // Drop the cursor-only field so it never reaches a client.
    return {
      nextCursor: page.nextCursor,
      items: page.items.map(({ __cursorValue: _cursor, ...row }) => row),
    };
  }

  // =========================================================================
  // Create / update / delete
  // =========================================================================

  async create(ctx: RequestContext, body: DocumentCreate): Promise<DocumentDetail> {
    const side = isSales(body.type) ? 'SALES' : 'PURCHASE';
    this.assertCan(ctx, 'create', {
      companyId: ctx.companyId,
      side,
      type: body.type,
      lifecycle: 'DRAFT',
      createdById: ctx.userId,
    });

    const settings = await this.companySettings(ctx.companyId);
    const contact = await this.loadContact(ctx, body.contactId);

    const id = await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          companyId: ctx.companyId,
          type: body.type,
          side,
          contactId: contact.id,
          billingAddressId: body.billingAddressId ?? null,
          shippingAddressId: body.shippingAddressId ?? null,
          warehouseId: body.warehouseId ?? settings.defaultWarehouseId,
          issueDate: body.issueDate ? new Date(body.issueDate) : new Date(),
          ...this.dateFieldsFor(body, contact),
          currency: body.currency ?? contact.defaultCurrency ?? settings.defaultCurrency,
          exchangeRate: toPrismaDecimal(body.exchangeRate ?? '1'),
          locale: body.locale ?? contact.defaultLocale ?? null,
          priceMode: body.priceMode ?? settings.priceMode,
          roundingMode: settings.rounding.mode,
          roundingScale: settings.rounding.scale,
          roundingGranularity: settings.rounding.granularity,
          globalDiscountKind: body.globalDiscount?.kind ?? null,
          globalDiscountValue: toPrismaDecimalOrNull(body.globalDiscount?.value),
          shippingAmount: toPrismaDecimalOrNull(body.shippingAmount),
          shippingVatRate: toPrismaDecimalOrNull(body.shippingVatRate),
          returnToStock: body.returnToStock ?? false,
          reference: body.reference ?? null,
          projectName: body.projectName ?? null,
          notes: body.notes ?? null,
          terms: body.terms ?? null,
          internalMemo: body.internalMemo ?? null,
          templateConfigId: body.templateConfigId ?? null,
          fulfilment: documentMeta(body.type).convertsTo.length > 0 ? 'PENDING' : 'NOT_APPLICABLE',
          settlement: documentMeta(body.type).settles ? 'UNPAID' : 'NOT_APPLICABLE',
          createdById: ctx.userId,
        },
      });

      await this.replaceLines(tx, document.id, body.lines ?? [], settings);
      await this.recomputeTotals(tx, document.id);
      return document.id;
    });

    return this.get(ctx, id);
  }

  async update(ctx: RequestContext, id: string, body: DocumentUpdate): Promise<DocumentDetail> {
    const existing = await this.loadDocument(this.prisma, ctx, id);
    this.assertCan(ctx, 'update', existing);

    if (existing.lifecycle !== Lifecycle.DRAFT) {
      throw AppError.conflict(
        'DOCUMENT_NOT_EDITABLE',
        `${existing.number ?? 'This document'} has been validated and can no longer be edited. Issue a credit note or cancel it.`,
      );
    }

    const settings = await this.companySettings(existing.companyId);
    const contact = body.contactId
      ? await this.loadContact(ctx, body.contactId)
      : await this.loadContact(ctx, existing.contactId);

    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id },
        data: {
          contactId: contact.id,
          ...(body.billingAddressId !== undefined ? { billingAddressId: body.billingAddressId } : {}),
          ...(body.shippingAddressId !== undefined ? { shippingAddressId: body.shippingAddressId } : {}),
          ...(body.warehouseId !== undefined ? { warehouseId: body.warehouseId } : {}),
          ...(body.issueDate ? { issueDate: new Date(body.issueDate) } : {}),
          ...(body.dueDate !== undefined
            ? { dueDate: body.dueDate ? new Date(body.dueDate) : null }
            : {}),
          ...(body.validUntil !== undefined
            ? { validUntil: body.validUntil ? new Date(body.validUntil) : null }
            : {}),
          ...(body.deliveryDate !== undefined
            ? { deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null }
            : {}),
          ...(body.currency ? { currency: body.currency } : {}),
          ...(body.exchangeRate ? { exchangeRate: toPrismaDecimal(body.exchangeRate) } : {}),
          ...(body.locale !== undefined ? { locale: body.locale } : {}),
          ...(body.priceMode ? { priceMode: body.priceMode } : {}),
          ...(body.globalDiscount !== undefined
            ? {
                globalDiscountKind: body.globalDiscount?.kind ?? null,
                globalDiscountValue: toPrismaDecimalOrNull(body.globalDiscount?.value),
              }
            : {}),
          ...(body.shippingAmount !== undefined
            ? { shippingAmount: toPrismaDecimalOrNull(body.shippingAmount) }
            : {}),
          ...(body.shippingVatRate !== undefined
            ? { shippingVatRate: toPrismaDecimalOrNull(body.shippingVatRate) }
            : {}),
          ...(body.returnToStock !== undefined ? { returnToStock: body.returnToStock } : {}),
          ...(body.reference !== undefined ? { reference: body.reference } : {}),
          ...(body.projectName !== undefined ? { projectName: body.projectName } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.terms !== undefined ? { terms: body.terms } : {}),
          ...(body.internalMemo !== undefined ? { internalMemo: body.internalMemo } : {}),
          ...(body.templateConfigId !== undefined
            ? { templateConfigId: body.templateConfigId }
            : {}),
        },
      });

      if (body.lines) {
        await this.replaceLines(tx, id, body.lines, settings);
      }
      await this.recomputeTotals(tx, id);
    });

    return this.get(ctx, id);
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    const existing = await this.loadDocument(this.prisma, ctx, id);
    this.assertCan(ctx, 'delete', existing);

    if (existing.lifecycle !== Lifecycle.DRAFT) {
      throw AppError.conflict(
        'DOCUMENT_NOT_DELETABLE',
        'Only a draft can be deleted. Cancel the document instead, so its number and history survive.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Deleting a converted draft must hand the quantity back to its source,
      // or the upstream order would stay blocked forever.
      await this.releaseDraws(tx, id);
      const upstream = await this.upstreamDocumentIds(tx, id);
      await tx.document.delete({ where: { id } });
      await this.refreshFulfilment(tx, upstream);
    });
  }

  async duplicate(
    ctx: RequestContext,
    id: string,
    issueDate: string | undefined,
  ): Promise<DocumentDetail> {
    const source = await this.loadDocument(this.prisma, ctx, id);
    this.assertCan(ctx, 'create', { ...source, lifecycle: 'DRAFT', createdById: ctx.userId });

    // A duplicate is a fresh draft: no number, no provenance, no stock history.
    return this.create(ctx, {
      type: source.type,
      contactId: source.contactId,
      billingAddressId: source.billingAddressId,
      shippingAddressId: source.shippingAddressId,
      warehouseId: source.warehouseId,
      issueDate: issueDate ?? new Date().toISOString().slice(0, 10),
      currency: source.currency,
      exchangeRate: dec(source.exchangeRate).toFixed(),
      locale: source.locale,
      priceMode: source.priceMode,
      globalDiscount: source.globalDiscountKind
        ? {
            kind: source.globalDiscountKind,
            value: dec(source.globalDiscountValue ?? 0).toFixed(),
          }
        : null,
      shippingAmount: source.shippingAmount ? moneyOut(source.shippingAmount) : null,
      shippingVatRate: source.shippingVatRate ? rateOut(source.shippingVatRate) : null,
      reference: source.reference,
      projectName: source.projectName,
      notes: source.notes,
      terms: source.terms,
      internalMemo: source.internalMemo,
      templateConfigId: source.templateConfigId,
      lines: source.lines.map((line, index) => ({
        variantId: line.variantId,
        warehouseId: line.warehouseId,
        description: line.description,
        quantity: qtyOut(line.quantity),
        unitPrice: qtyOut(line.unitPrice),
        unitCost: line.unitCost ? qtyOut(line.unitCost) : null,
        vatRate: rateOut(line.vatRate),
        discount: line.discountKind
          ? { kind: line.discountKind, value: qtyOut(line.discountValue ?? 0) }
          : null,
        isNote: line.isNote,
        isService: line.isService,
        sortOrder: index + 1,
      })),
    });
  }

  // =========================================================================
  // Validation
  // =========================================================================

  async validationPreview(ctx: RequestContext, id: string): Promise<ValidationPreview> {
    const document = await this.loadDocument(this.prisma, ctx, id);
    this.assertCan(ctx, 'validate', document);

    const settings = await this.companySettings(document.companyId);
    const plan = this.buildPlan(document, settings);
    const levels = await this.snapshotLevels(plan);
    const verdict = checkAvailability(plan, levels, settings.negativeStockPolicy);

    const labels = await this.variantLabels(plan);
    const levelIndex = new Map(levels.map((l) => [levelKey(l), l]));

    const detail = mapDocument(document);

    return {
      documentId: id,
      willAllocateNumber: document.number === null,
      nextNumberPreview:
        document.number ??
        (await this.numbering.preview(document.companyId, document.type, document.issueDate)),
      movements: plan.movements.map((movement) => {
        const label = labels.get(movement.variantId);
        const level = levelIndex.get(levelKey(movement));
        const before = dec(level?.onHand ?? 0);
        return {
          variantId: movement.variantId,
          sku: label?.sku ?? '',
          productName: label?.productName ?? '',
          variantLabel: label?.variantLabel ?? null,
          warehouseId: movement.warehouseId,
          warehouseCode: label?.warehouseCodes.get(movement.warehouseId) ?? '',
          direction: movement.direction,
          quantity: movement.quantity,
          onHandBefore: qtyOut(before),
          onHandAfter: qtyOut(before.plus(dec(movement.signedQuantity))),
        };
      }),
      reservations: plan.reservations.map((reservation) => ({
        variantId: reservation.variantId,
        sku: labels.get(reservation.variantId)?.sku ?? '',
        warehouseId: reservation.warehouseId,
        action: reservation.action,
        quantity: reservation.quantity,
      })),
      shortfalls: verdict.shortfalls.map((shortfall) => {
        const label = labels.get(shortfall.variantId);
        return {
          variantId: shortfall.variantId,
          sku: label?.sku ?? '',
          productName: label?.productName ?? '',
          warehouseId: shortfall.warehouseId,
          warehouseCode: label?.warehouseCodes.get(shortfall.warehouseId) ?? '',
          requested: shortfall.requested,
          available: shortfall.available,
          shortBy: shortfall.shortBy,
        };
      }),
      blocked: !verdict.ok,
      requiresConfirmation: verdict.requiresConfirmation,
      totals: detail.totals,
    };
  }

  /**
   * Validate: allocate the number, write the stock ledger and lock the document.
   *
   * Everything happens in one transaction. A number without its movements, or
   * movements without a number, are both states nobody can repair by hand.
   */
  async validate(
    ctx: RequestContext,
    id: string,
    confirmNegativeStock: boolean,
  ): Promise<DocumentDetail> {
    await this.prisma.$transaction(async (tx) => {
      const document = await this.loadDocument(tx, ctx, id);
      this.assertCan(ctx, 'validate', document);

      if (document.lifecycle !== Lifecycle.DRAFT) {
        throw AppError.conflict(
          'ALREADY_VALIDATED',
          `${document.number ?? 'This document'} has already been validated`,
        );
      }
      if (document.lines.filter((line) => !line.isNote).length === 0) {
        throw AppError.unprocessable('EMPTY_DOCUMENT', 'Add at least one line before validating');
      }

      const settings = await this.companySettings(document.companyId);
      const plan = this.buildPlan(document, settings);

      // Lock the levels before checking availability, so the check and the
      // write see the same numbers even under concurrent validation.
      await this.stock.lockLevels(tx, [
        ...plan.movements.map((m) => ({ variantId: m.variantId, warehouseId: m.warehouseId })),
        ...plan.reservations.map((r) => ({ variantId: r.variantId, warehouseId: r.warehouseId })),
      ]);

      const levels = await this.snapshotLevels(plan, tx);
      const verdict = checkAvailability(plan, levels, settings.negativeStockPolicy);

      if (!verdict.ok) {
        const labels = await this.variantLabels(plan, tx);
        throw AppError.unprocessable(
          'INSUFFICIENT_STOCK',
          `Not enough stock for ${verdict.shortfalls
            .map((s) => labels.get(s.variantId)?.sku ?? s.variantId)
            .join(', ')}`,
          { shortfalls: verdict.shortfalls },
        );
      }
      if (verdict.requiresConfirmation && !confirmNegativeStock) {
        throw AppError.conflict(
          'NEGATIVE_STOCK_CONFIRMATION_REQUIRED',
          'This would take stock negative. Confirm to proceed.',
          { shortfalls: verdict.shortfalls },
        );
      }

      const allocated = await this.numbering.allocate(
        tx,
        document.companyId,
        document.type,
        document.issueDate,
      );

      await this.stock.applyPlan(tx, plan, {
        userId: ctx.userId,
        documentId: document.id,
        movementType: movementTypeFor(document.type),
      });

      await tx.document.update({
        where: { id },
        data: {
          lifecycle: Lifecycle.VALIDATED,
          number: allocated.number,
          numberYear: allocated.year,
          sequence: allocated.sequence,
          validatedAt: new Date(),
        },
      });

      // Validating a conversion is what actually advances the source's
      // fulfilment, which is why it is recomputed here and not at conversion.
      await this.refreshFulfilment(tx, await this.upstreamDocumentIds(tx, id));
      await this.refreshFulfilment(tx, [id]);
    });

    return this.get(ctx, id);
  }

  async markSent(ctx: RequestContext, id: string): Promise<DocumentDetail> {
    const document = await this.loadDocument(this.prisma, ctx, id);
    this.assertCan(ctx, 'send', document);

    if (!isLive(document.lifecycle)) {
      throw AppError.conflict('NOT_VALIDATED', 'Validate the document before sending it');
    }

    await this.prisma.document.update({
      where: { id },
      data: { lifecycle: Lifecycle.SENT, sentAt: document.sentAt ?? new Date() },
    });
    return this.get(ctx, id);
  }

  /**
   * Cancel a validated document by writing compensating ledger rows.
   *
   * The original movements are never deleted: the ledger has to reconstruct the
   * history of a variant, including the mistakes.
   */
  async cancel(ctx: RequestContext, id: string, reason: string): Promise<DocumentDetail> {
    await this.prisma.$transaction(async (tx) => {
      const document = await this.loadDocument(tx, ctx, id);
      this.assertCan(ctx, 'cancel', document);

      if (document.lifecycle === Lifecycle.CANCELLED) {
        throw AppError.conflict('ALREADY_CANCELLED', 'This document is already cancelled');
      }

      const convertible = this.toConvertibleLines(document);
      if (!coreCanCancel(convertible)) {
        const blocking = document.linksFrom
          .filter((link) => link.targetDocument.lifecycle !== Lifecycle.CANCELLED)
          .map((link) => link.targetDocument.number ?? link.targetDocument.type);
        throw AppError.conflict(
          'HAS_DOWNSTREAM_DOCUMENTS',
          `Cancel ${blocking.join(', ') || 'the documents created from this one'} first`,
          { downstream: blocking },
        );
      }

      if (document.lifecycle !== Lifecycle.DRAFT) {
        const settings = await this.companySettings(document.companyId);
        const plan = this.buildPlan(document, settings);

        if (plan.movements.length > 0) {
          await this.stock.applyPlan(tx, invertPlan(plan), {
            userId: ctx.userId,
            documentId: document.id,
            movementType: 'CANCELLATION',
          });
        }
      }

      await this.stock.cancelReservationsForDocument(tx, id);
      await this.releaseDraws(tx, id);

      const upstream = await this.upstreamDocumentIds(tx, id);

      await tx.document.update({
        where: { id },
        data: {
          lifecycle: Lifecycle.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: reason,
        },
      });

      await this.refreshFulfilment(tx, upstream);
    });

    return this.get(ctx, id);
  }

  // =========================================================================
  // Conversion
  // =========================================================================

  async conversionOptions(
    ctx: RequestContext,
    id: string,
    targetType: DocumentType,
    alsoInclude: string[],
  ): Promise<ConversionOptions> {
    const ids = [id, ...alsoInclude.filter((other) => other !== id)];
    const documents = await Promise.all(ids.map((each) => this.loadDocument(this.prisma, ctx, each)));
    for (const document of documents) this.assertCan(ctx, 'convert', document);

    // Runs the same validation the conversion itself will, so the dialog cannot
    // offer a combination the server would then refuse.
    planConversion(documents.map((d) => this.toConversionSource(d)), targetType);

    return {
      targetType,
      sources: documents.map((document) => ({
        documentId: document.id,
        documentType: document.type,
        number: document.number,
        issueDate: document.issueDate.toISOString().slice(0, 10),
      })),
      lines: documents.flatMap((document) =>
        document.lines
          .filter((line) => !line.isNote)
          .map((line) => {
            const remaining = dec(line.quantity).minus(dec(line.drawnQuantity));
            return {
              sourceDocumentId: document.id,
              sourceDocumentNumber: document.number,
              sourceLineId: line.id,
              variantId: line.variantId,
              sku: line.sku ?? line.variant?.sku ?? null,
              description: line.description,
              variantLabel: line.variantLabel ?? line.variant?.variantLabel ?? null,
              ordered: qtyOut(line.quantity),
              alreadyDrawn: qtyOut(line.drawnQuantity),
              remaining: qtyOut(remaining.isNegative() ? 0 : remaining),
              unitPrice: qtyOut(line.unitPrice),
              vatRate: rateOut(line.vatRate),
            };
          }),
      ),
    };
  }

  /**
   * One-click conversion, including partial quantities and several sources at
   * once (which is what "invoice these three delivery notes" needs).
   */
  async convert(ctx: RequestContext, body: ConvertRequest): Promise<DocumentDetail> {
    const sources = await Promise.all(
      body.sourceDocumentIds.map((id) => this.loadDocument(this.prisma, ctx, id)),
    );
    for (const source of sources) this.assertCan(ctx, 'convert', source);

    const plan = planConversion(
      sources.map((source) => this.toConversionSource(source)),
      body.targetType,
      body.selections,
    );

    const settings = await this.companySettings(ctx.companyId);
    const first = sources[0]!;
    const contact = await this.loadContact(ctx, plan.contactId);
    const side = isSales(body.targetType) ? 'SALES' : 'PURCHASE';
    const issueDate = body.issueDate ? new Date(body.issueDate) : new Date();
    const typeMeta = documentMeta(body.targetType);

    const id = await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          companyId: plan.companyId,
          type: body.targetType,
          side,
          contactId: plan.contactId,
          billingAddressId: first.billingAddressId,
          shippingAddressId: first.shippingAddressId,
          warehouseId: body.warehouseId ?? first.warehouseId ?? settings.defaultWarehouseId,
          issueDate,
          dueDate: typeMeta.hasDueDate
            ? dueDateFrom(issueDate, contact.paymentTerm, contact.paymentTermDays)
            : null,
          currency: plan.currency,
          exchangeRate: first.exchangeRate,
          locale: first.locale,
          priceMode: first.priceMode,
          roundingMode: settings.rounding.mode,
          roundingScale: settings.rounding.scale,
          roundingGranularity: settings.rounding.granularity,
          // A consolidating invoice cannot inherit one source's global discount
          // without misstating the others, so discounts are re-entered.
          globalDiscountKind: sources.length === 1 ? first.globalDiscountKind : null,
          globalDiscountValue: sources.length === 1 ? first.globalDiscountValue : null,
          returnToStock: body.returnToStock ?? false,
          reference: first.number,
          projectName: first.projectName,
          terms: first.terms,
          templateConfigId: first.templateConfigId,
          fulfilment: typeMeta.convertsTo.length > 0 ? 'PENDING' : 'NOT_APPLICABLE',
          settlement: typeMeta.settles ? 'UNPAID' : 'NOT_APPLICABLE',
          createdById: ctx.userId,
        },
      });

      const sourceLineIndex = new Map(
        sources.flatMap((source) => source.lines.map((line) => [line.id, line])),
      );

      for (const planned of plan.lines) {
        const originLine = sourceLineIndex.get(planned.sources[0]!.sourceLineId);

        const line = await tx.documentLine.create({
          data: {
            documentId: document.id,
            variantId: planned.variantId,
            warehouseId:
              planned.warehouseId ?? body.warehouseId ?? settings.defaultWarehouseId,
            sku: originLine?.sku ?? originLine?.variant?.sku ?? null,
            description: planned.description,
            variantLabel: originLine?.variantLabel ?? null,
            unitCode: originLine?.unitCode ?? null,
            quantity: toPrismaDecimal(planned.quantity),
            unitPrice: toPrismaDecimal(planned.unitPrice),
            unitCost: toPrismaDecimalOrNull(planned.unitCost),
            vatRate: toPrismaDecimal(planned.vatRate),
            discountKind: planned.discount?.kind ?? null,
            discountValue: toPrismaDecimalOrNull(planned.discount?.value),
            isNote: planned.isNote,
            isService: planned.isService,
            sortOrder: planned.sortOrder,
          },
        });

        for (const source of planned.sources) {
          await tx.documentLineSource.create({
            data: {
              targetLineId: line.id,
              sourceLineId: source.sourceLineId,
              sourceDocumentId: source.sourceDocumentId,
              sourceDocumentType: source.sourceDocumentType,
              quantity: toPrismaDecimal(source.quantity),
            },
          });

          // Claim the quantity immediately, at draft time. Waiting until
          // validation would let two users each draft a delivery note for the
          // same remainder and both validate it.
          await tx.documentLine.update({
            where: { id: source.sourceLineId },
            data: { drawnQuantity: { increment: toPrismaDecimal(source.quantity) } },
          });
        }
      }

      for (const sourceId of plan.sourceDocumentIds) {
        await tx.documentLink.create({
          data: { sourceDocumentId: sourceId, targetDocumentId: document.id },
        });
      }

      await this.recomputeTotals(tx, document.id);
      await this.refreshFulfilment(tx, plan.sourceDocumentIds);
      return document.id;
    });

    if (body.validateImmediately) {
      return this.validate(ctx, id, false);
    }
    return this.get(ctx, id);
  }

  // =========================================================================
  // Totals preview
  // =========================================================================

  async totalsPreview(
    ctx: RequestContext,
    body: TotalsPreviewRequest,
  ): Promise<TotalsPreviewResponse> {
    const settings = await this.companySettings(ctx.companyId);
    const result = computeTotals({
      lines: body.lines.map((line) => ({
        id: line.id,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        discount: (line.discount ?? null) as Discount | null,
        isNote: line.isNote,
      })),
      globalDiscount: (body.globalDiscount ?? null) as Discount | null,
      shipping: body.shippingAmount
        ? { amount: body.shippingAmount, vatRate: body.shippingVatRate ?? '0' }
        : null,
      priceMode: body.priceMode ?? settings.priceMode,
      rounding: settings.rounding,
    });

    return { ...result, lines: result.lines };
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private assertCan(
    ctx: RequestContext,
    action: 'read' | 'create' | 'update' | 'delete' | 'validate' | 'cancel' | 'convert' | 'send',
    document: {
      companyId: string;
      side: 'SALES' | 'PURCHASE';
      type: DocumentType;
      lifecycle: Lifecycle | 'DRAFT';
      createdById: string | null;
    },
  ): void {
    const allowed = ctx.ability.can(
      action,
      subject('Document', {
        companyId: document.companyId,
        side: document.side,
        type: document.type,
        lifecycle: document.lifecycle,
        createdById: document.createdById ?? '',
      }),
    );
    if (!allowed) {
      throw AppError.forbidden(`Your role may not ${action} this document`);
    }
  }

  private async loadDocument(
    client: PrismaClient | PrismaTx,
    ctx: RequestContext,
    id: string,
  ): Promise<DocumentWithRelations> {
    const document = await client.document.findFirst({
      // Scoped to the companies this member may act in, so an id from another
      // tenant is a 404 rather than a leak.
      where: { id, companyId: { in: ctx.companyIds } },
      include: documentInclude,
    });
    if (!document) throw AppError.notFound('Document', id);
    return document;
  }

  private async loadContact(ctx: RequestContext, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId: ctx.organizationId },
      select: {
        id: true,
        paymentTerm: true,
        paymentTermDays: true,
        defaultCurrency: true,
        defaultLocale: true,
      },
    });
    if (!contact) throw AppError.notFound('Contact', contactId);
    return contact;
  }

  private async companySettings(companyId: string): Promise<CompanySettings> {
    const company: Pick<
      Company,
      | 'roundingMode'
      | 'roundingScale'
      | 'roundingGranularity'
      | 'priceMode'
      | 'negativeStockPolicy'
      | 'defaultWarehouseId'
      | 'defaultCurrency'
    > = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        roundingMode: true,
        roundingScale: true,
        roundingGranularity: true,
        priceMode: true,
        negativeStockPolicy: true,
        defaultWarehouseId: true,
        defaultCurrency: true,
      },
    });

    return {
      rounding: {
        mode: company.roundingMode,
        scale: company.roundingScale,
        granularity: company.roundingGranularity,
      },
      priceMode: company.priceMode,
      negativeStockPolicy: company.negativeStockPolicy,
      defaultWarehouseId: company.defaultWarehouseId,
      defaultCurrency: company.defaultCurrency,
    };
  }

  private dateFieldsFor(
    body: Pick<DocumentCreate, 'type' | 'issueDate' | 'dueDate' | 'validUntil' | 'deliveryDate'>,
    contact: { paymentTerm: Parameters<typeof dueDateFrom>[1]; paymentTermDays: number | null },
  ): { dueDate: Date | null; validUntil: Date | null; deliveryDate: Date | null } {
    const typeMeta = documentMeta(body.type);
    const issueDate = body.issueDate ? new Date(body.issueDate) : new Date();

    return {
      // Derived from the contact's payment terms unless the user overrode it.
      dueDate: body.dueDate
        ? new Date(body.dueDate)
        : typeMeta.hasDueDate
          ? dueDateFrom(issueDate, contact.paymentTerm, contact.paymentTermDays)
          : null,
      validUntil: body.validUntil
        ? new Date(body.validUntil)
        : typeMeta.hasValidityDate
          ? new Date(issueDate.getTime() + 30 * 86_400_000)
          : null,
      deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null,
    };
  }

  /**
   * Replace a draft's lines.
   *
   * Lines that came from a conversion carry provenance, so they are updated in
   * place rather than recreated, and a quantity lowered below what was drawn
   * from upstream hands the difference back to the source.
   */
  private async replaceLines(
    tx: PrismaTx,
    documentId: string,
    lines: LineInput[],
    settings: CompanySettings,
  ): Promise<void> {
    const existing = await tx.documentLine.findMany({
      where: { documentId },
      include: { sources: true },
    });
    const existingById = new Map(existing.map((line) => [line.id, line]));
    const keptIds = new Set<string>();

    const variantIds = lines.map((line) => line.variantId).filter((id): id is string => Boolean(id));
    const variants = await tx.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        sku: true,
        variantLabel: true,
        sellingPrice: true,
        costPrice: true,
        product: {
          select: { name: true, defaultVatRate: true, isService: true, unit: { select: { code: true } } },
        },
      },
    });
    const variantById = new Map(variants.map((variant) => [variant.id, variant]));

    for (const [index, input] of lines.entries()) {
      const variant = input.variantId ? variantById.get(input.variantId) : undefined;
      if (input.variantId && !variant) {
        throw AppError.notFound('Product variant', input.variantId);
      }

      const data = {
        variantId: input.variantId ?? null,
        warehouseId: input.warehouseId ?? settings.defaultWarehouseId,
        sku: variant?.sku ?? null,
        description:
          input.description ??
          [variant?.product.name, variant?.variantLabel].filter(Boolean).join(' — ') ??
          '',
        variantLabel: variant?.variantLabel ?? null,
        unitCode: variant?.product.unit?.code ?? null,
        quantity: toPrismaDecimal(input.quantity),
        unitPrice: toPrismaDecimal(input.unitPrice ?? variant?.sellingPrice ?? '0'),
        unitCost: toPrismaDecimalOrNull(input.unitCost ?? variant?.costPrice ?? null),
        vatRate: toPrismaDecimal(input.vatRate ?? variant?.product.defaultVatRate ?? '20'),
        discountKind: input.discount?.kind ?? null,
        discountValue: toPrismaDecimalOrNull(input.discount?.value),
        isNote: input.isNote,
        isService: input.isService || Boolean(variant?.product.isService),
        sortOrder: input.sortOrder ?? index + 1,
      };

      if (input.id && existingById.has(input.id)) {
        keptIds.add(input.id);
        await tx.documentLine.update({ where: { id: input.id }, data });
        await this.clampSourcesToQuantity(tx, input.id, input.quantity);
      } else {
        await tx.documentLine.create({ data: { ...data, documentId } });
      }
    }

    for (const line of existing) {
      if (keptIds.has(line.id)) continue;
      // Removing a converted line gives its quantity back to the source.
      for (const source of line.sources) {
        await tx.documentLine.update({
          where: { id: source.sourceLineId },
          data: { drawnQuantity: { decrement: source.quantity } },
        });
      }
      await tx.documentLine.delete({ where: { id: line.id } });
    }
  }

  /** Keep a line's source draws from exceeding its (possibly lowered) quantity. */
  private async clampSourcesToQuantity(
    tx: PrismaTx,
    lineId: string,
    quantity: string,
  ): Promise<void> {
    const sources = await tx.documentLineSource.findMany({
      where: { targetLineId: lineId },
      orderBy: { createdAt: 'asc' },
    });
    if (sources.length === 0) return;

    let budget = dec(quantity);
    for (const source of sources) {
      const current = dec(source.quantity);
      const keep = current.lte(budget) ? current : budget.gt(0) ? budget : dec(0);
      budget = budget.minus(keep);

      if (keep.eq(current)) continue;

      const released = current.minus(keep);
      if (keep.isZero()) {
        await tx.documentLineSource.delete({ where: { id: source.id } });
      } else {
        await tx.documentLineSource.update({
          where: { id: source.id },
          data: { quantity: toPrismaDecimal(keep) },
        });
      }
      await tx.documentLine.update({
        where: { id: source.sourceLineId },
        data: { drawnQuantity: { decrement: toPrismaDecimal(released) } },
      });
    }
  }

  /** Hand every quantity this document claimed back to its sources. */
  private async releaseDraws(tx: PrismaTx, documentId: string): Promise<void> {
    const sources = await tx.documentLineSource.findMany({
      where: { targetLine: { documentId } },
    });
    for (const source of sources) {
      await tx.documentLine.update({
        where: { id: source.sourceLineId },
        data: { drawnQuantity: { decrement: source.quantity } },
      });
    }
    await tx.documentLineSource.deleteMany({ where: { targetLine: { documentId } } });
  }

  private async upstreamDocumentIds(tx: PrismaTx, documentId: string): Promise<string[]> {
    const links = await tx.documentLink.findMany({
      where: { targetDocumentId: documentId },
      select: { sourceDocumentId: true },
    });
    return links.map((link) => link.sourceDocumentId);
  }

  /**
   * Recompute every money figure and write it back.
   *
   * Totals are derived, never user-supplied: a client could otherwise post a
   * total that disagrees with its own lines.
   */
  private async recomputeTotals(tx: PrismaTx, documentId: string): Promise<void> {
    const document = await tx.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });

    const input: TotalsInput = {
      lines: document.lines.map((line) => ({
        id: line.id,
        quantity: line.quantity.toFixed(),
        unitPrice: line.unitPrice.toFixed(),
        vatRate: line.vatRate.toFixed(),
        discount: line.discountKind
          ? { kind: line.discountKind, value: (line.discountValue ?? new Prisma.Decimal(0)).toFixed() }
          : null,
        isNote: line.isNote,
      })),
      globalDiscount: document.globalDiscountKind
        ? {
            kind: document.globalDiscountKind,
            value: (document.globalDiscountValue ?? new Prisma.Decimal(0)).toFixed(),
          }
        : null,
      shipping: document.shippingAmount
        ? {
            amount: document.shippingAmount.toFixed(),
            vatRate: (document.shippingVatRate ?? new Prisma.Decimal(0)).toFixed(),
          }
        : null,
      priceMode: document.priceMode,
      rounding: {
        mode: document.roundingMode,
        scale: document.roundingScale,
        granularity: document.roundingGranularity,
      },
    };

    const totals = computeTotals(input);
    const byId = new Map(totals.lines.map((line) => [line.id, line]));

    for (const line of document.lines) {
      const computed = byId.get(line.id);
      if (!computed) continue;
      await tx.documentLine.update({
        where: { id: line.id },
        data: {
          lineGross: toPrismaDecimal(computed.gross),
          lineDiscount: toPrismaDecimal(computed.lineDiscount),
          lineNet: toPrismaDecimal(computed.net),
          globalDiscountShare: toPrismaDecimal(computed.globalDiscountShare),
          taxableBase: toPrismaDecimal(computed.taxableBase),
          vatAmount: toPrismaDecimal(computed.vatAmount),
          lineTotal: toPrismaDecimal(computed.total),
        },
      });
    }

    await tx.document.update({
      where: { id: documentId },
      data: {
        subtotalGross: toPrismaDecimal(totals.subtotalGross),
        totalLineDiscounts: toPrismaDecimal(totals.totalLineDiscounts),
        subtotalNet: toPrismaDecimal(totals.subtotalNet),
        globalDiscount: toPrismaDecimal(totals.globalDiscount),
        totalExclVat: toPrismaDecimal(totals.totalExclVat),
        totalVat: toPrismaDecimal(totals.totalVat),
        totalInclVat: toPrismaDecimal(totals.totalInclVat),
        vatBreakdown: totals.vatBuckets as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Recompute fulfilment from draws made by *validated* downstream documents.
   *
   * `drawnQuantity` deliberately counts drafts too, so the same remainder
   * cannot be converted twice; fulfilment must not, or an order would look
   * delivered the moment someone opened a delivery note they never validated.
   */
  private async refreshFulfilment(tx: PrismaTx, documentIds: string[]): Promise<void> {
    for (const documentId of [...new Set(documentIds)]) {
      const document = await tx.document.findUnique({
        where: { id: documentId },
        include: {
          lines: {
            where: { isNote: false },
            include: {
              drawnBy: {
                where: { targetLine: { document: { lifecycle: { in: ['VALIDATED', 'SENT'] } } } },
                select: { quantity: true },
              },
            },
          },
        },
      });
      if (!document) continue;

      const fulfilment = computeFulfilment(
        document.type,
        document.lines.map((line) => ({
          quantity: line.quantity.toFixed(),
          drawnQuantity: line.drawnBy
            .reduce((acc, draw) => acc.plus(dec(draw.quantity.toFixed())), dec(0))
            .toFixed(),
        })),
      );

      if (fulfilment !== document.fulfilment) {
        await tx.document.update({ where: { id: documentId }, data: { fulfilment } });
      }
    }
  }

  /** Recompute settlement and the cached paid amount from allocations. */
  async refreshSettlement(tx: PrismaTx, documentId: string): Promise<void> {
    const document = await tx.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { allocations: { select: { amount: true } } },
    });

    const paid = document.allocations.reduce(
      (acc, allocation) => acc.plus(dec(allocation.amount.toFixed())),
      dec(0),
    );

    await tx.document.update({
      where: { id: documentId },
      data: {
        paidAmount: toPrismaDecimal(paid),
        settlement: computeSettlement(
          document.type,
          document.totalInclVat.toFixed(),
          paid.toFixed(),
        ),
      },
    });
  }

  // ----- plan building -----------------------------------------------------

  private buildPlan(document: DocumentWithRelations, settings: CompanySettings): StockImpactPlan {
    return resolveStockImpact({
      documentType: document.type,
      documentId: document.id,
      defaultWarehouseId: document.warehouseId ?? settings.defaultWarehouseId,
      returnToStock: document.returnToStock,
      lines: document.lines.map((line) => ({
        lineId: line.id,
        variantId: line.variantId,
        warehouseId: line.warehouseId,
        quantity: line.quantity.toFixed(),
        unitCost: line.unitCost?.toFixed() ?? null,
        isService: line.isService,
        // Only draws from documents that really moved stock may net against
        // this one. A draft source has moved nothing, so counting it would
        // make the stock vanish from the ledger entirely.
        sources: line.sources
          .filter((source) => isLive(source.sourceLine.document.lifecycle))
          .map((source) => ({
            sourceDocumentType: source.sourceDocumentType,
            sourceDocumentId: source.sourceDocumentId,
            sourceLineId: source.sourceLineId,
            quantity: source.quantity.toFixed(),
          })),
      })),
    });
  }

  private async snapshotLevels(
    plan: StockImpactPlan,
    tx?: PrismaTx,
  ): Promise<Array<AvailabilitySnapshot & { onHand: string }>> {
    const client = tx ?? this.prisma;
    const keys = plan.netByVariant.map((entry) => ({
      variantId: entry.variantId,
      warehouseId: entry.warehouseId,
    }));
    if (keys.length === 0) return [];

    const rows = await client.stockLevel.findMany({
      where: { OR: keys },
      select: { variantId: true, warehouseId: true, onHand: true, reserved: true },
    });

    return rows.map((row) => ({
      variantId: row.variantId,
      warehouseId: row.warehouseId,
      onHand: row.onHand.toFixed(),
      reserved: row.reserved.toFixed(),
    }));
  }

  private async variantLabels(
    plan: StockImpactPlan,
    tx?: PrismaTx,
  ): Promise<
    Map<
      string,
      { sku: string; productName: string; variantLabel: string | null; warehouseCodes: Map<string, string> }
    >
  > {
    const client = tx ?? this.prisma;
    const variantIds = [
      ...new Set([
        ...plan.movements.map((m) => m.variantId),
        ...plan.reservations.map((r) => r.variantId),
        ...plan.netByVariant.map((n) => n.variantId),
      ]),
    ];
    const warehouseIds = [
      ...new Set([
        ...plan.movements.map((m) => m.warehouseId),
        ...plan.netByVariant.map((n) => n.warehouseId),
      ]),
    ];

    const [variants, warehouses] = await Promise.all([
      client.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: {
          id: true,
          sku: true,
          variantLabel: true,
          product: { select: { name: true } },
        },
      }),
      client.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, code: true },
      }),
    ]);

    const warehouseCodes = new Map(warehouses.map((w) => [w.id, w.code]));

    return new Map(
      variants.map((variant) => [
        variant.id,
        {
          sku: variant.sku,
          productName: variant.product.name,
          variantLabel: variant.variantLabel,
          warehouseCodes,
        },
      ]),
    );
  }

  /** Live availability for the lines of a document, for the editor's warnings. */
  private async availabilityFor(document: DocumentWithRelations): Promise<AvailabilityIndex> {
    const keys = document.lines
      .filter((line) => line.variantId && line.warehouseId)
      .map((line) => ({ variantId: line.variantId!, warehouseId: line.warehouseId! }));
    if (keys.length === 0) return new Map();

    const rows = await this.prisma.stockLevel.findMany({
      where: { OR: keys },
      select: {
        variantId: true,
        warehouseId: true,
        onHand: true,
        reserved: true,
        variant: { select: { minStockThreshold: true } },
      },
    });

    return new Map(
      rows.map((row) => {
        const available = dec(row.onHand.toFixed()).minus(dec(row.reserved.toFixed()));
        return [
          levelKey(row),
          {
            available: qtyOut(available),
            isLowStock: available.lte(dec(row.variant.minStockThreshold.toFixed())),
          },
        ];
      }),
    );
  }

  // ----- conversions to core shapes ---------------------------------------

  private toConvertibleLines(document: DocumentWithRelations): ConvertibleLine[] {
    return document.lines.map((line) => ({
      lineId: line.id,
      variantId: line.variantId,
      description: line.description,
      quantity: line.quantity.toFixed(),
      drawnQuantity: line.drawnQuantity.toFixed(),
      unitPrice: line.unitPrice.toFixed(),
      vatRate: line.vatRate.toFixed(),
      discount: line.discountKind
        ? { kind: line.discountKind, value: (line.discountValue ?? new Prisma.Decimal(0)).toFixed() }
        : null,
      unitCost: line.unitCost?.toFixed() ?? null,
      warehouseId: line.warehouseId,
      isNote: line.isNote,
      isService: line.isService,
      sortOrder: line.sortOrder,
    }));
  }

  private toConversionSource(document: DocumentWithRelations): ConversionSource {
    return {
      documentId: document.id,
      documentNumber: document.number,
      documentType: document.type,
      lifecycle: document.lifecycle,
      companyId: document.companyId,
      contactId: document.contactId,
      currency: document.currency,
      issueDate: document.issueDate,
      lines: this.toConvertibleLines(document),
    };
  }

  private toListRow(
    row: Prisma.DocumentGetPayload<{
      include: {
        contact: { select: { displayName: true } };
        createdBy: { select: { fullName: true } };
      };
    }>,
    now: Date,
  ): DocumentListRow & { __cursorValue: string } {
    const statusInput = {
      type: row.type,
      lifecycle: row.lifecycle,
      fulfilment: row.fulfilment,
      settlement: row.settlement,
      dueDate: row.dueDate,
    };

    return {
      __cursorValue: row.createdAt.toISOString(),
      id: row.id,
      type: row.type,
      number: row.number,
      draftLabel: row.number ? null : row.id.replace(/-/g, '').slice(0, 6).toUpperCase(),
      issueDate: row.issueDate.toISOString().slice(0, 10),
      dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null,
      contactId: row.contactId,
      contactName: row.contact.displayName,
      currency: row.currency,
      totalExclVat: moneyOut(row.totalExclVat),
      totalInclVat: moneyOut(row.totalInclVat),
      paidAmount: moneyOut(row.paidAmount),
      // Only documents that actually settle carry a balance; showing one on a
      // delivery note invites someone to chase a payment that is not owed.
      outstandingAmount:
        row.settlement === 'NOT_APPLICABLE'
          ? '0.00'
          : moneyOut(
              dec(row.totalInclVat.toFixed()).abs().minus(dec(row.paidAmount.toFixed()).abs()),
            ),
      lifecycle: row.lifecycle,
      fulfilment: row.fulfilment,
      settlement: row.settlement,
      isOverdue: isOverdue(statusInput, now),
      badges: documentBadges(statusInput, now),
      createdByName: row.createdBy?.fullName ?? null,
    };
  }
}
