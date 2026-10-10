import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { treasurySchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';

type Method = z.infer<typeof treasurySchemas.paymentMethod>;
type MethodBody = z.infer<typeof treasurySchemas.paymentMethodBody>;

const DEFAULT_METHODS = [
  { name: 'Espèces', kind: 'CASH', requiresReference: false, deferred: false },
  { name: 'Virement', kind: 'BANK_TRANSFER', requiresReference: true, deferred: false },
  { name: 'Chèque', kind: 'CHEQUE', requiresReference: true, deferred: true },
  { name: 'Effet de commerce', kind: 'BILL_OF_EXCHANGE', requiresReference: true, deferred: true },
  { name: 'Carte bancaire', kind: 'CARD', requiresReference: false, deferred: false },
  { name: 'Autre', kind: 'OTHER', requiresReference: false, deferred: false },
] as const;

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: RequestContext): Promise<Method[]> {
    if (!ctx.ability.can('read', 'Payment')) throw AppError.forbidden('Your role may not see payments');
    await this.ensureDefaults(ctx.organizationId);
    const rows = await this.prisma.paymentMethodConfig.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(mapMethod);
  }

  async create(ctx: RequestContext, body: MethodBody): Promise<Method> {
    if (!ctx.ability.can('update', 'Payment')) throw AppError.forbidden('Your role may not edit payment methods');
    try {
      const row = await this.prisma.paymentMethodConfig.create({
        data: { organizationId: ctx.organizationId, ...body },
      });
      return mapMethod(row);
    } catch (cause) {
      throw duplicate(cause);
    }
  }

  async update(ctx: RequestContext, id: string, body: Partial<MethodBody>): Promise<Method> {
    if (!ctx.ability.can('update', 'Payment')) throw AppError.forbidden('Your role may not edit payment methods');
    const existing = await this.prisma.paymentMethodConfig.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!existing) throw AppError.notFound('Payment method', id);
    try {
      const row = await this.prisma.paymentMethodConfig.update({ where: { id }, data: body });
      return mapMethod(row);
    } catch (cause) {
      throw duplicate(cause);
    }
  }

  /** Resolve a picked method to its behaviour; throws when it is not usable. */
  async resolve(organizationId: string, id: string) {
    const row = await this.prisma.paymentMethodConfig.findFirst({ where: { id, organizationId } });
    if (!row) throw AppError.notFound('Payment method', id);
    if (!row.isActive) {
      throw AppError.unprocessable('METHOD_INACTIVE', 'This payment method is switched off');
    }
    return row;
  }

  private async ensureDefaults(organizationId: string): Promise<void> {
    const count = await this.prisma.paymentMethodConfig.count({ where: { organizationId } });
    if (count > 0) return;
    await this.prisma.paymentMethodConfig.createMany({
      data: DEFAULT_METHODS.map((method, index) => ({ organizationId, sortOrder: index + 1, ...method })),
      skipDuplicates: true,
    });
  }
}

function duplicate(cause: unknown): unknown {
  if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
    return AppError.conflict('DUPLICATE_METHOD', 'A payment method with this name already exists');
  }
  return cause;
}

function mapMethod(row: {
  id: string;
  name: string;
  kind: Method['kind'];
  requiresReference: boolean;
  deferred: boolean;
  isActive: boolean;
  sortOrder: number;
}): Method {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    requiresReference: row.requiresReference,
    deferred: row.deferred,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}
