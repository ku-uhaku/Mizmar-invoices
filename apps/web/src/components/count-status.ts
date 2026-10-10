import type { BadgeTone } from './ui';

/** Count session status, shared by the list and the detail page. */
export const COUNT_STATUS: Record<string, { tone: BadgeTone; label: string }> = {
  OPEN: { tone: 'info', label: 'Ouvert' },
  COUNTING: { tone: 'info', label: 'Comptage en cours' },
  REVIEW: { tone: 'progress', label: 'À valider' },
  POSTED: { tone: 'success', label: 'Validé' },
  ABANDONED: { tone: 'neutral', label: 'Abandonné' },
};
