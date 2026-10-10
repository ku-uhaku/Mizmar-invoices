import { describe, expect, it } from 'vitest';
import { planFefo, type LotCandidate } from './lots';

const lot = (id: string, quantity: string, expiryDate: string | null, receivedAt = '2026-01-01T00:00:00Z'): LotCandidate => ({
  id,
  quantity,
  expiryDate,
  receivedAt,
});

describe('planFefo', () => {
  it('draws from the earliest expiry first', () => {
    const draws = planFefo([lot('late', '10', '2027-06-01'), lot('soon', '10', '2026-12-01')], '4');
    expect(draws).toEqual([{ lotId: 'soon', quantity: '4' }]);
  });

  it('spills over to the next lot when one runs out', () => {
    const draws = planFefo([lot('soon', '3', '2026-12-01'), lot('late', '10', '2027-06-01')], '5');
    expect(draws).toEqual([
      { lotId: 'soon', quantity: '3' },
      { lotId: 'late', quantity: '2' },
    ]);
  });

  it('uses lots without an expiry last', () => {
    const draws = planFefo([lot('none', '5', null), lot('dated', '5', '2030-01-01')], '7');
    expect(draws.map((d) => d.lotId)).toEqual(['dated', 'none']);
  });

  it('breaks expiry ties by oldest receipt', () => {
    const draws = planFefo(
      [lot('new', '5', '2027-01-01', '2026-06-01T00:00:00Z'), lot('old', '5', '2027-01-01', '2026-01-01T00:00:00Z')],
      '2',
    );
    expect(draws[0]!.lotId).toBe('old');
  });

  it('draws only what the lots hold, leaving the rest unassigned', () => {
    const draws = planFefo([lot('a', '2', '2027-01-01')], '5');
    expect(draws).toEqual([{ lotId: 'a', quantity: '2' }]);
  });

  it('ignores empty lots and handles fractions', () => {
    const draws = planFefo([lot('empty', '0', '2026-01-01'), lot('a', '1.5', '2027-01-01')], '1.25');
    expect(draws).toEqual([{ lotId: 'a', quantity: '1.25' }]);
  });

  it('plans nothing for nothing', () => {
    expect(planFefo([lot('a', '5', null)], '0')).toEqual([]);
  });
});
