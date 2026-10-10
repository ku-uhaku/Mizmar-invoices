import type { BadgeTone } from '@/components/ui';

export type PaymentStatus = 'PENDING' | 'DEPOSITED' | 'CLEARED' | 'BOUNCED' | 'CANCELLED';

/** French source labels (translation keys) and badge tones per status. */
export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'En attente', tone: 'progress' },
  DEPOSITED: { label: 'Remis en banque', tone: 'info' },
  CLEARED: { label: 'Encaissé en banque', tone: 'success' },
  BOUNCED: { label: 'Impayé', tone: 'danger' },
  CANCELLED: { label: 'Annulé', tone: 'neutral' },
};

/** Mirrors the API: where each status may go next. */
export const NEXT_STATUSES: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED'],
  DEPOSITED: ['CLEARED', 'BOUNCED', 'PENDING'],
  CLEARED: ['BOUNCED'],
  BOUNCED: ['PENDING', 'CANCELLED'],
  CANCELLED: [],
};

/** The verb on the button that moves a payment to `status`. */
export const STATUS_ACTION: Record<PaymentStatus, string> = {
  PENDING: 'Remettre en attente',
  DEPOSITED: 'Remettre en banque',
  CLEARED: 'Marquer encaissé',
  BOUNCED: 'Déclarer impayé',
  CANCELLED: 'Annuler',
};
