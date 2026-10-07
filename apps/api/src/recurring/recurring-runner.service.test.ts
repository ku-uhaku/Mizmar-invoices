import { describe, expect, it } from 'vitest';
import {
  MAX_CONSECUTIVE_FAILURES,
  MAX_RUNS_PER_TICK,
  RecurringRunnerService,
} from './recurring-runner.service';

const K1 = '00000000-0000-4000-8000-000000000001';
const BAD = '00000000-0000-4000-8000-000000000002';
const d = (date: string) => new Date(`${date}T00:00:00.000Z`);
const key = (recurringId: string, scheduledFor: Date) =>
  `${recurringId}|${scheduledFor.toISOString().slice(0, 10)}`;

interface Sched {
  id: string;
  companyId: string;
  contactId: string;
  createdById: string;
  name: string;
  template: unknown;
  frequency: 'MONTHLY';
  interval: number;
  startDate: Date;
  endDate: Date | null;
  maxOccurrences: number | null;
  timezone: string;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  occurrencesCount: number;
  consecutiveFailures: number;
  mode: 'DRAFT' | 'VALIDATE' | 'VALIDATE_AND_EMAIL';
  isActive: boolean;
  contact: { email: string | null; displayName: string };
}

function schedule(id: string, extra: Partial<Sched> = {}): Sched {
  return {
    id,
    companyId: 'c1',
    contactId: K1,
    createdById: 'u1',
    name: id,
    template: { lines: [{ quantity: '1', unitPrice: '100' }] },
    frequency: 'MONTHLY',
    interval: 1,
    startDate: d('2027-01-31'),
    endDate: null,
    maxOccurrences: null,
    timezone: 'Africa/Casablanca',
    nextRunAt: d('2027-01-31'),
    lastRunAt: null,
    occurrencesCount: 0,
    consecutiveFailures: 0,
    mode: 'DRAFT',
    isActive: true,
    contact: { email: 'a@b.c', displayName: 'ACME' },
    ...extra,
  };
}

/** Just enough of Prisma, with real row-lock (SKIP LOCKED) semantics. */
function harness(schedules: Sched[], options: { failFor?: Set<string> } = {}) {
  const rows = new Map(schedules.map((s) => [s.id, s]));
  const runs = new Map<string, Record<string, unknown>>();
  const locks = new Set<string>();
  const documents: Array<{ contactId: string; issueDate: string }> = [];

  const matches = (row: Sched, where: Record<string, unknown>) =>
    where.isActive === undefined || row.isActive === where.isActive;

  const client = {
    recurringInvoice: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        [...rows.values()].filter((r) => r.nextRunAt && matches(r, where)).map((r) => ({ id: r.id })),
      findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Sched> }) =>
        Object.assign(rows.get(where.id)!, data),
    },
    recurringInvoiceRun: {
      findUnique: async ({ where }: { where: { recurringId_scheduledFor: { recurringId: string; scheduledFor: Date } } }) =>
        runs.get(key(where.recurringId_scheduledFor.recurringId, where.recurringId_scheduledFor.scheduledFor)) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { recurringId_scheduledFor: { recurringId: string; scheduledFor: Date } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const k = key(where.recurringId_scheduledFor.recurringId, where.recurringId_scheduledFor.scheduledFor);
        const row = runs.get(k)
          ? { ...runs.get(k), ...update }
          : { id: `run-${runs.size + 1}`, runAt: new Date(), ...create };
        runs.set(k, row);
        return row;
      },
    },
    company: { findUnique: async () => ({ organizationId: 'o1' }) },
    membership: { findFirst: async () => ({ id: 'm1', user: { email: 'u@x.y' } }) },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const held: string[] = [];
      const tx = {
        ...client,
        $queryRaw: async (_s: TemplateStringsArray, id: string) => {
          if (locks.has(id)) return [];
          locks.add(id);
          held.push(id);
          return [{ id }];
        },
      };
      try {
        return await fn(tx);
      } finally {
        held.forEach((id) => locks.delete(id));
      }
    },
  };

  const documentsService = {
    create: async (_ctx: unknown, body: { contactId: string; issueDate: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 5)); // widen the race window
      if (options.failFor?.has(body.contactId)) throw new Error('boom');
      documents.push({ contactId: body.contactId, issueDate: body.issueDate });
      return { id: `doc-${documents.length}` };
    },
    validate: async () => ({ number: 'FA-1' }),
  };
  const auth = { loadContext: async () => ({ organizationName: 'Org', email: 'u@x.y' }) };
  const delivery = { sendByEmail: async () => undefined };

  const runner = new RecurringRunnerService(
    client as never,
    documentsService as never,
    delivery as never,
    auth as never,
  );
  return { runner, rows, runs, documents };
}

describe('RecurringRunnerService', () => {
  it('generates a due occurrence once and advances the schedule', async () => {
    const { runner, rows, runs, documents } = harness([schedule('s1')]);
    const result = await runner.tick(new Date('2027-01-31T10:00:00Z'));

    expect(result).toEqual({ generated: 1, failed: 0 });
    expect(documents).toEqual([{ contactId: K1, issueDate: '2027-01-31' }]);
    expect(runs.size).toBe(1);
    const row = rows.get('s1')!;
    expect(row.occurrencesCount).toBe(1);
    expect(row.nextRunAt).toEqual(d('2027-02-28')); // clamped, anchored to the 31st
  });

  it('does nothing before the due date, when paused, or for another timezone day', async () => {
    const { runner, documents } = harness([
      schedule('early'),
      schedule('paused', { isActive: false }),
    ]);
    await runner.tick(new Date('2027-01-30T22:00:00Z'));
    expect(documents).toHaveLength(0);
  });

  it('never double-generates when two instances tick concurrently', async () => {
    const { runner, documents, runs } = harness([schedule('s1')]);
    const now = new Date('2027-01-31T10:00:00Z');
    const [a, b] = await Promise.all([runner.runNext('s1', { now }), runner.runNext('s1', { now })]);

    expect([a.outcome, b.outcome].sort()).toEqual(['generated', 'stop']);
    expect(documents).toHaveLength(1);
    expect(runs.size).toBe(1);
  });

  it('is idempotent when ticked repeatedly', async () => {
    const { runner, documents } = harness([schedule('s1')]);
    const now = new Date('2027-01-31T10:00:00Z');
    await runner.tick(now);
    await runner.tick(now);
    await runner.tick(now);
    expect(documents).toHaveLength(1);
  });

  it('repairs a lagging counter without generating a second document', async () => {
    const { runner, rows, runs, documents } = harness([schedule('s1')]);
    runs.set(key('s1', d('2027-01-31')), { id: 'run-x', status: 'OK', runAt: new Date() });

    await runner.runNext('s1', { now: new Date('2027-01-31T10:00:00Z') });
    expect(documents).toHaveLength(0);
    expect(rows.get('s1')!.occurrencesCount).toBe(1);
  });

  it('catches up missed runs in capped batches, oldest first', async () => {
    const { runner, documents } = harness([schedule('s1')]);
    const now = new Date('2027-08-15T10:00:00Z'); // Jan..Jul = 7 due

    await runner.tick(now);
    expect(documents).toHaveLength(MAX_RUNS_PER_TICK);
    expect(documents.map((x) => x.issueDate)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
      '2027-05-31',
    ]);

    await runner.tick(now);
    expect(documents).toHaveLength(7);
    await runner.tick(now);
    expect(documents).toHaveLength(7);
  });

  it('stops at the end of the series', async () => {
    const { runner, rows, documents } = harness([schedule('s1', { maxOccurrences: 2 })]);
    await runner.tick(new Date('2028-01-01T00:00:00Z'));
    expect(documents).toHaveLength(2);
    expect(rows.get('s1')!.nextRunAt).toBeNull();
  });

  it('records a failure without blocking other schedules, and pauses after repeated failures', async () => {
    const { runner, rows, runs, documents } = harness(
      [schedule('bad', { contactId: BAD }), schedule('good')],
      { failFor: new Set([BAD]) },
    );
    const now = new Date('2027-01-31T10:00:00Z');

    const first = await runner.tick(now);
    expect(first).toEqual({ generated: 1, failed: 1 });
    expect(documents).toHaveLength(1);
    expect(runs.get(key('bad', d('2027-01-31')))).toMatchObject({ status: 'FAILED', error: 'boom' });
    expect(rows.get('bad')!.occurrencesCount).toBe(0); // retried next tick

    for (let i = 1; i < MAX_CONSECUTIVE_FAILURES; i++) await runner.tick(now);
    expect(rows.get('bad')!.isActive).toBe(false);
    expect(runs.size).toBe(2); // one row per occurrence, updated in place
  });

  it('run-now generates the next occurrence dated today', async () => {
    const { runner, rows, documents } = harness([schedule('s1', { nextRunAt: d('2027-03-31'), occurrencesCount: 2 })]);
    await runner.runNext('s1', {
      now: new Date('2027-03-10T10:00:00Z'),
      manual: { ctx: { organizationName: 'Org' } as never },
    });
    expect(documents).toEqual([{ contactId: K1, issueDate: '2027-03-10' }]);
    expect(rows.get('s1')!.occurrencesCount).toBe(3);
  });
});
