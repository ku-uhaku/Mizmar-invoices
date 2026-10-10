import { describe, expect, it } from 'vitest';
import { leaveEntitlement, workingDays, workingDaysWithin } from './leave';

describe('workingDays', () => {
  it('counts Monday to Saturday', () => {
    // 2026-10-05 is a Monday; Sunday 11th is skipped.
    expect(workingDays('2026-10-05', '2026-10-11')).toBe(6);
  });
  it('is inclusive and handles a single day', () => {
    expect(workingDays('2026-10-07', '2026-10-07')).toBe(1);
    expect(workingDays('2026-10-11', '2026-10-11')).toBe(0);
  });
  it('is zero for a reversed range', () => {
    expect(workingDays('2026-10-08', '2026-10-07')).toBe(0);
  });
});

describe('workingDaysWithin', () => {
  it('clips a leave to a month', () => {
    expect(workingDaysWithin('2026-09-28', '2026-10-03', '2026-10-01', '2026-10-31')).toBe(3);
  });
  it('is zero when outside', () => {
    expect(workingDaysWithin('2026-08-01', '2026-08-05', '2026-10-01', '2026-10-31')).toBe(0);
  });
});

describe('leaveEntitlement', () => {
  it('gives the full year to earlier hires', () => {
    expect(leaveEntitlement(18, '2024-05-10', 2026)).toBe(18);
  });
  it('pro-rates the hire year by whole months', () => {
    expect(leaveEntitlement(18, '2026-03-15', 2026)).toBe(15);
    expect(leaveEntitlement(18, '2026-12-01', 2026)).toBe(1.5);
  });
  it('is zero before the hire year', () => {
    expect(leaveEntitlement(18, '2027-01-01', 2026)).toBe(0);
  });
});
