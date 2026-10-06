import { Injectable } from '@nestjs/common';
import type { DocumentType } from '@prisma/client';
import {
  DEFAULT_NUMBER_FORMAT,
  defaultPrefix,
  formatDocumentNumber,
  sequenceKey,
} from '@mizmar/core';
import { PrismaService, type PrismaTx } from '../prisma/prisma.service';

export interface AllocatedNumber {
  number: string;
  year: number;
  sequence: number;
}

/**
 * Gap-free document numbering, per company, type and year.
 *
 * Numbers are allocated at validation, never at draft creation, so abandoned
 * drafts do not burn numbers — which matters because a tax authority reading a
 * sequence with holes in it will ask where the missing invoices went.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Take the next number, inside the caller's transaction.
   *
   * A Postgres advisory lock on (company, type, year) serialises concurrent
   * validations. It is cheaper than SERIALIZABLE retries and blocks only the
   * one sequence, so invoicing does not wait on quoting.
   */
  async allocate(
    tx: PrismaTx,
    companyId: string,
    type: DocumentType,
    issueDate: Date,
  ): Promise<AllocatedNumber> {
    const year = issueDate.getUTCFullYear();
    const key = sequenceKey(companyId, type, year);

    return this.prisma.withAdvisoryLock(tx, key, async () => {
      const company = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { code: true },
      });

      const existing = await tx.numberSequence.findUnique({
        where: { companyId_type_year: { companyId, type, year } },
      });

      const prefix = existing?.prefix ?? defaultPrefix(type);
      const format = existing?.format ?? DEFAULT_NUMBER_FORMAT;
      const sequence = (existing?.counter ?? 0) + 1;

      if (existing) {
        await tx.numberSequence.update({
          where: { id: existing.id },
          data: { counter: sequence },
        });
      } else {
        await tx.numberSequence.create({
          data: { companyId, type, year, prefix, format, counter: sequence },
        });
      }

      return {
        number: formatDocumentNumber(format, {
          prefix,
          sequence,
          year,
          month: issueDate.getUTCMonth() + 1,
          companyCode: company.code,
        }),
        year,
        sequence,
      };
    });
  }

  /** What the next validated document of this type would be numbered. */
  async preview(companyId: string, type: DocumentType, at: Date = new Date()): Promise<string> {
    const year = at.getUTCFullYear();
    const [company, existing] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { code: true } }),
      this.prisma.numberSequence.findUnique({
        where: { companyId_type_year: { companyId, type, year } },
      }),
    ]);

    return formatDocumentNumber(existing?.format ?? DEFAULT_NUMBER_FORMAT, {
      prefix: existing?.prefix ?? defaultPrefix(type),
      sequence: (existing?.counter ?? 0) + 1,
      year,
      month: at.getUTCMonth() + 1,
      companyCode: company.code,
    });
  }
}
