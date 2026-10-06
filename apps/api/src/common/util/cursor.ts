/**
 * Opaque keyset cursors.
 *
 * Offset paging drifts on a busy list: validate a document while a user is on
 * page 3 and a row they have already seen shifts down into it. A keyset cursor
 * over (sortValue, id) is stable under concurrent inserts.
 */
export interface Cursor {
  /** The sort column's value on the last row of the previous page. */
  value: string;
  /** Tiebreaker, so rows sharing a sort value still page deterministically. */
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.value}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(encoded: string | undefined): Cursor | null {
  if (!encoded) return null;
  try {
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    const separator = raw.lastIndexOf('|');
    if (separator <= 0) return null;
    return { value: raw.slice(0, separator), id: raw.slice(separator + 1) };
  } catch {
    return null;
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Trim an over-fetched result set into a page plus the cursor for the next one.
 * Query `limit + 1` rows; the extra row is how we know more exist without a
 * second COUNT.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => Cursor,
): Page<T> {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: last ? encodeCursor(cursorOf(last)) : null,
  };
}
