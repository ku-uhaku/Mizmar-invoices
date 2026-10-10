import { dec } from '@mizmar/core';

export interface MatchLine {
  /** ISO date. */
  date: string;
  amount: string;
  description: string;
  reference: string | null;
}

export interface MatchCandidate {
  kind: 'PAYMENT' | 'EXPENSE_PAYMENT';
  id: string;
  /** Signed like the statement: in is positive, out is negative. */
  amount: string;
  paidAt: string;
  /** Cheques and bills: the date they can be cashed. */
  dueDate: string | null;
  reference: string | null;
  /** Customer, supplier or expense label. */
  label: string;
}

/** Days a bank may take to show a payment, in either direction. */
export const MATCH_WINDOW_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

const norm = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function dayGap(a: string, b: string): number {
  return Math.abs(Math.round((new Date(a).getTime() - new Date(b).getTime()) / DAY));
}

/** Days between the statement line and the nearest date the payment could clear. */
function nearestGap(line: MatchLine, candidate: MatchCandidate): number {
  return Math.min(
    dayGap(line.date, candidate.paidAt),
    candidate.dueDate ? dayGap(line.date, candidate.dueDate) : Infinity,
  );
}

/**
 * How well a candidate fits a statement line, or null when it cannot be the
 * same money. The amount must be identical; the rest only ranks candidates.
 */
export function scoreMatch(line: MatchLine, candidate: MatchCandidate): number | null {
  if (!dec(line.amount).eq(dec(candidate.amount))) return null;

  const gap = nearestGap(line, candidate);
  if (gap > MATCH_WINDOW_DAYS) return null;

  const haystack = ` ${norm(`${line.description} ${line.reference ?? ''}`)} `;
  let score = MATCH_WINDOW_DAYS - gap;

  const reference = candidate.reference ? norm(candidate.reference) : '';
  if (reference.length >= 3 && haystack.includes(` ${reference} `)) score += 100;

  // A distinctive word of the party's name (3+ letters) showing up is a hint.
  const words = norm(candidate.label)
    .split(' ')
    .filter((word) => word.length >= 4);
  if (words.some((word) => haystack.includes(` ${word} `) || haystack.includes(word))) score += 20;

  return score;
}

export function rankCandidates(line: MatchLine, candidates: MatchCandidate[]) {
  return candidates
    .map((candidate) => ({ candidate, score: scoreMatch(line, candidate) }))
    .filter((entry): entry is { candidate: MatchCandidate; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score);
}

/**
 * The candidate to match automatically, or null when it is a judgement call:
 * either the reference is quoted on the statement, or it is the only one
 * with that amount and it is close in time.
 */
export function autoPick(line: MatchLine, candidates: MatchCandidate[]): MatchCandidate | null {
  const ranked = rankCandidates(line, candidates);
  const best = ranked[0];
  if (!best) return null;
  if (best.score >= 100 && (ranked[1]?.score ?? 0) < 100) return best.candidate;
  if (ranked.length === 1 && nearestGap(line, best.candidate) <= 3) return best.candidate;
  return null;
}
