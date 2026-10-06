import { dec, type Numeric } from '../money';
import {
  meta,
  type DocumentType,
  type Fulfilment,
  type Lifecycle,
  type Settlement,
} from './types';

/**
 * Legal lifecycle moves. Everything can be cancelled; nothing comes back from
 * cancellation, because a validated document's number and stock movements have
 * already been issued. Corrections go through a credit note.
 */
const LIFECYCLE_TRANSITIONS: Record<Lifecycle, readonly Lifecycle[]> = {
  DRAFT: ['VALIDATED', 'CANCELLED'],
  VALIDATED: ['SENT', 'CANCELLED'],
  SENT: ['CANCELLED'],
  CANCELLED: [],
};

export function canTransition(from: Lifecycle, to: Lifecycle): boolean {
  return (LIFECYCLE_TRANSITIONS[from] ?? []).includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: Lifecycle,
    readonly to: Lifecycle,
  ) {
    super(`Illegal document transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function assertTransition(from: Lifecycle, to: Lifecycle): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/** A validated document's lines, numbers and contact are frozen. */
export function isEditable(lifecycle: Lifecycle): boolean {
  return lifecycle === 'DRAFT';
}

export function isLive(lifecycle: Lifecycle): boolean {
  return lifecycle === 'VALIDATED' || lifecycle === 'SENT';
}

/** Document types whose progress downstream is meaningful to show. */
export function tracksFulfilment(type: DocumentType): boolean {
  return meta(type).convertsTo.length > 0;
}

export interface FulfilmentLineInput {
  quantity: Numeric;
  /** Total quantity drawn from this line by downstream documents. */
  drawnQuantity: Numeric;
}

/**
 * Derive fulfilment from how much of each line downstream documents have drawn.
 * Never stored as an authoritative value — recomputed whenever a downstream
 * document is validated or cancelled, so it cannot go stale.
 */
export function computeFulfilment(
  type: DocumentType,
  lines: FulfilmentLineInput[],
): Fulfilment {
  if (!tracksFulfilment(type)) return 'NOT_APPLICABLE';

  const payable = lines.filter((l) => dec(l.quantity).gt(0));
  if (payable.length === 0) return 'NOT_APPLICABLE';

  let anyDrawn = false;
  let allComplete = true;

  for (const line of payable) {
    const quantity = dec(line.quantity);
    const drawn = dec(line.drawnQuantity);
    if (drawn.gt(0)) anyDrawn = true;
    if (drawn.lt(quantity)) allComplete = false;
  }

  if (allComplete) return 'COMPLETE';
  return anyDrawn ? 'PARTIAL' : 'PENDING';
}

/** What "fulfilled" means for this type, as an i18n key for the badge. */
export function fulfilmentLabelKey(type: DocumentType): string {
  switch (type) {
    case 'DEVIS':
      return 'fulfilment.ordered';
    case 'SALES_ORDER':
      return 'fulfilment.delivered';
    case 'DELIVERY_NOTE':
      return 'fulfilment.invoiced';
    case 'PURCHASE_ORDER':
      return 'fulfilment.received';
    case 'GOODS_RECEIPT':
      return 'fulfilment.invoiced';
    case 'SALES_INVOICE':
    case 'PURCHASE_INVOICE':
      // What flows downstream from an invoice is a credit note.
      return 'fulfilment.credited';
    default:
      return 'fulfilment.none';
  }
}

export function computeSettlement(
  type: DocumentType,
  totalInclVat: Numeric,
  allocatedAmount: Numeric,
): Settlement {
  if (!meta(type).settles) return 'NOT_APPLICABLE';

  // A credit note's total is negative from the customer's side; compare magnitudes.
  const total = dec(totalInclVat).abs();
  const paid = dec(allocatedAmount).abs();

  if (total.isZero()) return 'PAID';
  if (paid.gte(total)) return 'PAID';
  return paid.gt(0) ? 'PARTIAL' : 'UNPAID';
}

export function outstandingAmount(totalInclVat: Numeric, allocatedAmount: Numeric): string {
  const remaining = dec(totalInclVat).abs().minus(dec(allocatedAmount).abs());
  return (remaining.isNegative() ? dec(0) : remaining).toFixed(2);
}

export interface DocumentStatusInput {
  type: DocumentType;
  lifecycle: Lifecycle;
  fulfilment: Fulfilment;
  settlement: Settlement;
  dueDate?: Date | string | null;
}

/**
 * Overdue is never stored: it is a function of the clock, and a stored copy is
 * wrong by the next morning.
 */
export function isOverdue(doc: DocumentStatusInput, now: Date = new Date()): boolean {
  if (!isLive(doc.lifecycle)) return false;
  if (doc.settlement === 'PAID' || doc.settlement === 'NOT_APPLICABLE') return false;
  if (!doc.dueDate) return false;
  const due = doc.dueDate instanceof Date ? doc.dueDate : new Date(doc.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  return now.getTime() > due.getTime();
}

export type BadgeKey =
  | 'DRAFT'
  | 'VALIDATED'
  | 'SENT'
  | 'CANCELLED'
  | 'PENDING'
  | 'PARTIALLY_FULFILLED'
  | 'FULFILLED'
  | 'UNPAID'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE';

export type BadgeTone = 'neutral' | 'info' | 'progress' | 'success' | 'danger';

export interface Badge {
  key: BadgeKey;
  tone: BadgeTone;
  /** i18n message key; for fulfilment badges it is type-specific. */
  labelKey: string;
}

/**
 * The badges a user sees, derived from the three orthogonal status fields.
 *
 * Keeping lifecycle, fulfilment and settlement separate in storage is what lets
 * an invoice be honestly "Sent / Partially Delivered / Overdue" all at once,
 * which a single status enum cannot express.
 */
export function documentBadges(doc: DocumentStatusInput, now: Date = new Date()): Badge[] {
  if (doc.lifecycle === 'CANCELLED') {
    return [{ key: 'CANCELLED', tone: 'danger', labelKey: 'status.cancelled' }];
  }

  const badges: Badge[] = [];

  if (doc.lifecycle === 'DRAFT') {
    badges.push({ key: 'DRAFT', tone: 'neutral', labelKey: 'status.draft' });
  } else if (doc.lifecycle === 'SENT') {
    badges.push({ key: 'SENT', tone: 'info', labelKey: 'status.sent' });
  } else {
    badges.push({ key: 'VALIDATED', tone: 'info', labelKey: 'status.validated' });
  }

  const fulfilmentLabel = fulfilmentLabelKey(doc.type);
  if (doc.lifecycle !== 'DRAFT' && doc.fulfilment !== 'NOT_APPLICABLE') {
    if (doc.fulfilment === 'PARTIAL') {
      badges.push({
        key: 'PARTIALLY_FULFILLED',
        tone: 'progress',
        labelKey: `${fulfilmentLabel}.partial`,
      });
    } else if (doc.fulfilment === 'COMPLETE') {
      badges.push({ key: 'FULFILLED', tone: 'success', labelKey: `${fulfilmentLabel}.complete` });
    }
  }

  if (doc.lifecycle !== 'DRAFT' && doc.settlement !== 'NOT_APPLICABLE') {
    if (doc.settlement === 'PAID') {
      badges.push({ key: 'PAID', tone: 'success', labelKey: 'status.paid' });
    } else if (isOverdue(doc, now)) {
      badges.push({ key: 'OVERDUE', tone: 'danger', labelKey: 'status.overdue' });
      if (doc.settlement === 'PARTIAL') {
        badges.push({ key: 'PARTIALLY_PAID', tone: 'progress', labelKey: 'status.partiallyPaid' });
      }
    } else if (doc.settlement === 'PARTIAL') {
      badges.push({ key: 'PARTIALLY_PAID', tone: 'progress', labelKey: 'status.partiallyPaid' });
    } else {
      badges.push({ key: 'UNPAID', tone: 'neutral', labelKey: 'status.unpaid' });
    }
  }

  return badges;
}
