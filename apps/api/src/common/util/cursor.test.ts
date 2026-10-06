import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, toPage } from './cursor';

describe('cursor', () => {
  it('round-trips, including a separator inside the value', () => {
    const cursor = { value: '2026-10-06T12:00:00.000Z|odd', id: 'abc' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('treats garbage as no cursor rather than throwing', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('!!!')).toBeNull();
  });
});

describe('toPage', () => {
  const rows = [1, 2, 3, 4, 5].map((n) => ({ n }));
  const cursorOf = (row: { n: number }) => ({ value: String(row.n), id: String(row.n) });

  it('trims the over-fetched row and points the cursor at the last kept one', () => {
    const page = toPage(rows, 4, cursorOf);
    expect(page.items).toHaveLength(4);
    expect(decodeCursor(page.nextCursor!)?.id).toBe('4');
  });

  it('has no next cursor on the last page', () => {
    expect(toPage(rows, 5, cursorOf).nextCursor).toBeNull();
  });
});
