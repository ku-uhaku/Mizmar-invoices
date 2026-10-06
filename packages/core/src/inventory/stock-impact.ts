import { dec, Decimal, money, type Numeric, type RoundingConfig, sum, ZERO } from '../money';
import { DOCUMENT_META, meta, type DocumentType, type StockDirection } from '../documents/types';

/** One upstream line this line was drawn from, and how much it drew. */
export interface LineSourceDraw {
  sourceDocumentType: DocumentType;
  sourceDocumentId: string;
  sourceLineId: string;
  quantity: Numeric;
}

export interface StockImpactLine {
  lineId: string;
  /** Null for narrative lines (headings, free text), which never move stock. */
  variantId: string | null;
  warehouseId?: string | null;
  quantity: Numeric;
  /** Purchase unit cost; stamped onto inbound movements for weighted average. */
  unitCost?: Numeric | null;
  sources?: LineSourceDraw[];
  /** A service line (labour, shipping) carries no stock even with a variant. */
  isService?: boolean;
}

export interface StockImpactInput {
  documentType: DocumentType;
  documentId: string;
  lines: StockImpactLine[];
  defaultWarehouseId?: string | null;
  /**
   * Credit notes only put goods back when the customer actually returned them.
   * Ignored for every other document type.
   */
  returnToStock?: boolean;
}

export interface PlannedMovement {
  lineId: string;
  variantId: string;
  warehouseId: string;
  direction: StockDirection;
  /** Always positive; `signedQuantity` carries the ledger sign. */
  quantity: string;
  signedQuantity: string;
  unitCost: string | null;
}

export type ReservationAction = 'HOLD' | 'RELEASE';

export interface PlannedReservation {
  lineId: string;
  variantId: string;
  warehouseId: string;
  direction: StockDirection;
  action: ReservationAction;
  quantity: string;
  /** For a RELEASE, the order line whose hold is being consumed. */
  sourceLineId: string | null;
}

export interface StockImpactPlan {
  documentType: DocumentType;
  documentId: string;
  movements: PlannedMovement[];
  reservations: PlannedReservation[];
  /** Net on-hand change per variant+warehouse; what the availability check uses. */
  netByVariant: Array<{ variantId: string; warehouseId: string; signedQuantity: string }>;
}

const QTY_SCALE: RoundingConfig = { mode: 'HALF_UP', scale: 6, granularity: 'DOCUMENT' };

function qty(value: Numeric | null | undefined): string {
  return money(value ?? 0, QTY_SCALE);
}

/**
 * How much of this line has already been moved into stock by an upstream
 * document, in the same direction.
 *
 * Direction matters: a credit note drawn from an invoice must not net against
 * it, because the invoice moved stock OUT and the credit note moves it IN.
 */
function alreadyMoved(line: StockImpactLine, direction: StockDirection): Decimal {
  const draws = (line.sources ?? []).filter((s) => {
    const m = DOCUMENT_META[s.sourceDocumentType];
    return Boolean(m?.movesStock) && m?.stockDirection === direction;
  });
  return sum(draws.map((d) => dec(d.quantity)));
}

/**
 * Reservations held by upstream order lines that this document now consumes.
 * A delivery note drawn from a sales order releases that order's hold; an
 * invoice drawn from a delivery note releases nothing, because the delivery
 * note already did.
 */
function reservationsToRelease(
  line: StockImpactLine,
  direction: StockDirection,
): LineSourceDraw[] {
  return (line.sources ?? []).filter(
    (s) => DOCUMENT_META[s.sourceDocumentType]?.reserves === direction,
  );
}

/**
 * Turn a document about to be validated into the exact set of stock ledger
 * rows and reservation changes it should produce.
 *
 * The governing rule, applied uniformly to every type: a document moves stock
 * only for the quantity that no upstream stock-affecting document already
 * moved in the same direction. That single rule is what makes
 * quote -> order -> delivery note -> invoice deduct exactly once, whether the
 * user goes through every step, skips the delivery note, or splits one order
 * across several deliveries and then invoices them together.
 *
 * Pure and synchronous: the caller writes the plan inside the same database
 * transaction as the validation itself.
 */
export function resolveStockImpact(input: StockImpactInput): StockImpactPlan {
  const m = meta(input.documentType);
  const movements: PlannedMovement[] = [];
  const reservations: PlannedReservation[] = [];
  const net = new Map<string, { variantId: string; warehouseId: string; q: Decimal }>();

  const bumpNet = (variantId: string, warehouseId: string, signed: Decimal) => {
    const key = `${variantId}::${warehouseId}`;
    const entry = net.get(key);
    if (entry) entry.q = entry.q.plus(signed);
    else net.set(key, { variantId, warehouseId, q: signed });
  };

  // A credit note with the goods kept by the customer is a pure money document.
  const suppressMovements =
    input.documentType === 'CREDIT_NOTE' && input.returnToStock !== true;

  for (const line of input.lines) {
    if (!line.variantId || line.isService) continue;

    const warehouseId = line.warehouseId ?? input.defaultWarehouseId ?? null;
    if (!warehouseId) {
      throw new Error(
        `Line ${line.lineId} has no warehouse and the document has no default warehouse`,
      );
    }

    const lineQty = dec(line.quantity);
    if (lineQty.lte(0)) continue;

    // --- Reservations held by this document (sales order / purchase order) ---
    if (m.reserves) {
      reservations.push({
        lineId: line.lineId,
        variantId: line.variantId,
        warehouseId,
        direction: m.reserves,
        action: 'HOLD',
        quantity: qty(lineQty),
        sourceLineId: null,
      });
    }

    if (!m.movesStock || !m.stockDirection) continue;

    const direction = m.stockDirection;

    // --- Reservations this document consumes from upstream orders ---
    for (const draw of reservationsToRelease(line, direction)) {
      const drawQty = dec(draw.quantity);
      if (drawQty.lte(0)) continue;
      reservations.push({
        lineId: line.lineId,
        variantId: line.variantId,
        warehouseId,
        direction,
        action: 'RELEASE',
        quantity: qty(drawQty),
        sourceLineId: draw.sourceLineId,
      });
    }

    if (suppressMovements) continue;

    // --- The residual rule ---
    const covered = alreadyMoved(line, direction);
    const residual = lineQty.minus(covered);
    if (residual.lte(0)) continue;

    const signed = direction === 'OUT' ? residual.negated() : residual;

    movements.push({
      lineId: line.lineId,
      variantId: line.variantId,
      warehouseId,
      direction,
      quantity: qty(residual),
      signedQuantity: qty(signed),
      unitCost: line.unitCost === null || line.unitCost === undefined ? null : qty(line.unitCost),
    });

    bumpNet(line.variantId, warehouseId, signed);
  }

  return {
    documentType: input.documentType,
    documentId: input.documentId,
    movements,
    reservations,
    netByVariant: [...net.values()].map((e) => ({
      variantId: e.variantId,
      warehouseId: e.warehouseId,
      signedQuantity: qty(e.q),
    })),
  };
}

/** Compensating plan for cancelling an already-validated document. */
export function invertPlan(plan: StockImpactPlan): StockImpactPlan {
  return {
    ...plan,
    movements: plan.movements.map((mv) => ({
      ...mv,
      direction: mv.direction === 'OUT' ? 'IN' : 'OUT',
      signedQuantity: qty(dec(mv.signedQuantity).negated()),
    })),
    reservations: plan.reservations.map((r) => ({
      ...r,
      action: r.action === 'HOLD' ? 'RELEASE' : 'HOLD',
    })),
    netByVariant: plan.netByVariant.map((n) => ({
      ...n,
      signedQuantity: qty(dec(n.signedQuantity).negated()),
    })),
  };
}

export type NegativeStockPolicy = 'BLOCK' | 'WARN' | 'ALLOW';

export interface AvailabilitySnapshot {
  variantId: string;
  warehouseId: string;
  onHand: Numeric;
  reserved: Numeric;
}

export interface AvailabilityShortfall {
  variantId: string;
  warehouseId: string;
  requested: string;
  available: string;
  shortBy: string;
}

export interface AvailabilityVerdict {
  ok: boolean;
  /** True when the policy is WARN and the user must confirm. */
  requiresConfirmation: boolean;
  shortfalls: AvailabilityShortfall[];
}

/**
 * Check a plan against current levels before writing it.
 *
 * Outbound movements are checked against `onHand` because the goods are
 * physically leaving; a hold placed by the order this delivery came from is
 * released in the same transaction, so counting `reserved` against it would
 * double-penalise the very order being fulfilled.
 */
export function checkAvailability(
  plan: StockImpactPlan,
  levels: AvailabilitySnapshot[],
  policy: NegativeStockPolicy = 'BLOCK',
): AvailabilityVerdict {
  if (policy === 'ALLOW') return { ok: true, requiresConfirmation: false, shortfalls: [] };

  const index = new Map(levels.map((l) => [`${l.variantId}::${l.warehouseId}`, l]));
  const shortfalls: AvailabilityShortfall[] = [];

  for (const entry of plan.netByVariant) {
    const signed = dec(entry.signedQuantity);
    if (signed.gte(0)) continue;

    const level = index.get(`${entry.variantId}::${entry.warehouseId}`);
    const onHand = dec(level?.onHand ?? 0);
    const requested = signed.negated();

    if (requested.gt(onHand)) {
      shortfalls.push({
        variantId: entry.variantId,
        warehouseId: entry.warehouseId,
        requested: qty(requested),
        available: qty(onHand),
        shortBy: qty(requested.minus(onHand)),
      });
    }
  }

  if (shortfalls.length === 0) return { ok: true, requiresConfirmation: false, shortfalls };
  return {
    ok: policy === 'WARN',
    requiresConfirmation: policy === 'WARN',
    shortfalls,
  };
}

/** available = onHand - reserved. The number the editor shows next to a line. */
export function availableQuantity(onHand: Numeric, reserved: Numeric): string {
  return qty(dec(onHand).minus(dec(reserved)));
}

export const ZERO_QTY = qty(ZERO);
