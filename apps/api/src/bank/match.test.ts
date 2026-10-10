import { describe, expect, it } from 'vitest';
import { autoPick, rankCandidates, scoreMatch, type MatchCandidate, type MatchLine } from './match';

const line: MatchLine = { date: '2026-10-10', amount: '1200.00', description: 'VIR RECU ATLAS TRADING CHQ 4412', reference: null };
const cand = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  kind: 'PAYMENT',
  id: 'p1',
  amount: '1200.00',
  paidAt: '2026-10-09',
  dueDate: null,
  reference: null,
  label: 'Atlas Trading',
  ...over,
});

describe('scoreMatch', () => {
  it('needs the same signed amount', () => {
    expect(scoreMatch(line, cand({ amount: '-1200.00' }))).toBeNull();
    expect(scoreMatch(line, cand({ amount: '1200.01' }))).toBeNull();
  });
  it('rejects payments too far away in time', () => {
    expect(scoreMatch(line, cand({ paidAt: '2026-06-01' }))).toBeNull();
  });
  it('uses the due date of a cheque', () => {
    expect(scoreMatch(line, cand({ paidAt: '2026-08-01', dueDate: '2026-10-10' }))).not.toBeNull();
  });
  it('rewards a quoted reference and the party name', () => {
    const plain = scoreMatch(line, cand())!;
    expect(scoreMatch(line, cand({ reference: '4412' }))!).toBeGreaterThanOrEqual(plain + 100);
    expect(scoreMatch(line, cand({ label: 'Autre Societe' }))!).toBeLessThan(plain);
  });
});

describe('autoPick', () => {
  it('picks a lone close candidate', () => {
    expect(autoPick(line, [cand()])?.id).toBe('p1');
  });
  it('refuses to guess between two equal candidates', () => {
    expect(autoPick(line, [cand(), cand({ id: 'p2' })])).toBeNull();
  });
  it('lets a quoted reference break the tie', () => {
    expect(autoPick(line, [cand(), cand({ id: 'p2', reference: 'CHQ 4412' })])?.id).toBe('p2');
  });
  it('does not auto-pick a lone but distant candidate', () => {
    expect(autoPick(line, [cand({ paidAt: '2026-09-20' })])).toBeNull();
  });
  it('ranks best first', () => {
    const ranked = rankCandidates(line, [cand({ id: 'far', paidAt: '2026-09-25' }), cand({ id: 'near' })]);
    expect(ranked.map((r) => r.candidate.id)).toEqual(['near', 'far']);
  });
});
