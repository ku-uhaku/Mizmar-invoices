import * as SQLite from 'expo-sqlite';
import { API_URL } from './api';
import { readSession } from './session';

/**
 * Offline write queue.
 *
 * A warehouse has dead spots, so a stock adjustment is written to local SQLite
 * first and flushed when the network returns. Each entry carries a
 * client-generated idempotency key that the API honours, so a flush that is
 * interrupted and retried can never deduct the same damaged goods twice.
 */
export interface OutboxEntry {
  id: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body: string;
  label: string;
  attempts: number;
  lastError: string | null;
  createdAt: number;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const database = await SQLite.openDatabaseAsync('mizmar-outbox.db');
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        body TEXT NOT NULL,
        label TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    return database;
  })();
  return dbPromise;
}

const uuid = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export async function enqueue(
  entry: Pick<OutboxEntry, 'method' | 'path' | 'label'> & { body: unknown },
): Promise<string> {
  const id = uuid();
  const database = await db();
  await database.runAsync(
    'INSERT INTO outbox (id, method, path, body, label, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    entry.method,
    entry.path,
    JSON.stringify(entry.body),
    entry.label,
    Date.now(),
  );
  notify();
  return id;
}

export async function pending(): Promise<OutboxEntry[]> {
  const database = await db();
  const rows = await database.getAllAsync<{
    id: string;
    method: OutboxEntry['method'];
    path: string;
    body: string;
    label: string;
    attempts: number;
    last_error: string | null;
    created_at: number;
  }>('SELECT * FROM outbox ORDER BY created_at ASC');

  return rows.map((row) => ({
    id: row.id,
    method: row.method,
    path: row.path,
    body: row.body,
    label: row.label,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
  }));
}

export async function discard(id: string): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM outbox WHERE id = ?', id);
  notify();
}

const listeners = new Set<() => void>();
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function notify(): void {
  for (const listener of listeners) listener();
}

let flushing = false;

/**
 * Send queued writes oldest-first.
 *
 * Order matters: an adjustment queued before a count must land before it. A
 * network failure stops the flush and keeps everything; a 4xx means the server
 * understood and refused, so retrying forever would only block the queue — that
 * entry is parked with its error for the user to review.
 */
export async function flush(): Promise<{ sent: number; failed: number }> {
  if (flushing) return { sent: 0, failed: 0 };
  flushing = true;

  let sent = 0;
  let failed = 0;

  try {
    const database = await db();
    for (const entry of await pending()) {
      if (entry.lastError && entry.attempts >= 3) continue;

      const { accessToken, companyId } = await readSession();
      let response: Response;
      try {
        response = await fetch(`${API_URL}${entry.path}`, {
          method: entry.method,
          headers: {
            'content-type': 'application/json',
            // The entry id doubles as the idempotency key, so a retry of the
            // very same queued write is recognised by the server.
            'idempotency-key': entry.id,
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
            ...(companyId ? { 'x-company-id': companyId } : {}),
          },
          body: entry.body,
        });
      } catch {
        // No network: stop here and keep the rest for next time.
        break;
      }

      if (response.ok) {
        await database.runAsync('DELETE FROM outbox WHERE id = ?', entry.id);
        sent += 1;
      } else if (response.status === 401) {
        break;
      } else if (response.status >= 400 && response.status < 500) {
        const message = ((await response.json().catch(() => ({}))) as { message?: string }).message;
        await database.runAsync(
          'UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?',
          message ?? `HTTP ${response.status}`,
          entry.id,
        );
        failed += 1;
      } else {
        break;
      }
    }
  } finally {
    flushing = false;
    notify();
  }

  return { sent, failed };
}
