import { dec } from '@mizmar/core';
import type { PrismaService } from '../prisma/prisma.service';

export interface OpeningExposure {
  contactId: string;
  contactName: string;
  asOf: Date;
  /** What is still owed from the opening balance after advances not tied to an invoice. */
  outstanding: string;
}

/**
 * Opening balances still owed, for the ageing reports. Money received (or paid,
 * for suppliers) without an invoice settles the opening balance first.
 */
export async function openingExposure(
  prisma: PrismaService,
  companyId: string,
  side: 'CLIENT' | 'SUPPLIER',
  contactId?: string,
): Promise<OpeningExposure[]> {
  const rows = await prisma.contactOpeningBalance.findMany({
    where: {
      companyId,
      amount: { gt: 0 },
      ...(contactId ? { contactId } : {}),
      contact: side === 'SUPPLIER' ? { kind: 'SUPPLIER' } : { kind: { in: ['CLIENT', 'BOTH'] } },
    },
    select: { contactId: true, asOf: true, amount: true, contact: { select: { displayName: true } } },
  });
  if (rows.length === 0) return [];

  const payments = await prisma.payment.findMany({
    where: {
      companyId,
      contactId: { in: rows.map((row) => row.contactId) },
      direction: side === 'SUPPLIER' ? 'OUTBOUND' : 'INBOUND',
      status: { notIn: ['BOUNCED', 'CANCELLED'] },
    },
    select: { contactId: true, amount: true, allocations: { select: { amount: true } } },
  });
  const spare = new Map<string, ReturnType<typeof dec>>();
  for (const payment of payments) {
    const applied = payment.allocations.reduce((sum, a) => sum.plus(dec(a.amount.toFixed())), dec(0));
    const left = dec(payment.amount.toFixed()).abs().minus(applied);
    if (left.gt(0)) spare.set(payment.contactId, (spare.get(payment.contactId) ?? dec(0)).plus(left));
  }

  return rows
    .map((row) => ({
      contactId: row.contactId,
      contactName: row.contact.displayName,
      asOf: row.asOf,
      outstanding: dec(row.amount.toFixed()).minus(spare.get(row.contactId) ?? dec(0)),
    }))
    .filter((row) => row.outstanding.gt(0))
    .map((row) => ({ ...row, outstanding: row.outstanding.toFixed(2) }));
}
