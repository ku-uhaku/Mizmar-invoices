import { Injectable } from '@nestjs/common';
import { Prisma, type DocumentType } from '@prisma/client';
import {
  DEFAULT_NUMBER_FORMAT,
  defaultPrefix,
  DOCUMENT_TYPES,
  formatDocumentNumber,
} from '@mizmar/core';
import { DEFAULT_TEMPLATE_CONFIG, withDefaults } from '@mizmar/doc-template';
import type { settingsSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import {
  nullableMoneyOut,
  rateOut,
  toPrismaDecimal,
  toPrismaDecimalOrNull,
} from '../common/util/decimal';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { hashPassword } from '../auth/password';
import { PdfService } from '../pdf/pdf.service';

type Company = z.infer<typeof settingsSchemas.company>;
type CompanyCreate = z.infer<typeof settingsSchemas.companyCreate>;
type CompanyUpdate = z.infer<typeof settingsSchemas.companyUpdate>;
type VatRate = z.infer<typeof settingsSchemas.vatRate>;
type VatRateInput = z.infer<typeof settingsSchemas.vatRateInput>;
type NumberSequence = z.infer<typeof settingsSchemas.numberSequence>;
type NumberSequenceUpdate = z.infer<typeof settingsSchemas.numberSequenceUpdate>;
type Membership = z.infer<typeof settingsSchemas.membership>;
type MembershipInvite = z.infer<typeof settingsSchemas.membershipInvite>;
type MembershipUpdate = z.infer<typeof settingsSchemas.membershipUpdate>;
type TemplateConfig = z.infer<typeof settingsSchemas.templateConfig>;
type TemplateConfigCreate = z.infer<typeof settingsSchemas.templateConfigCreate>;
type TemplateConfigUpdate = z.infer<typeof settingsSchemas.templateConfigUpdate>;
type TemplatePreviewRequest = z.infer<typeof settingsSchemas.templatePreviewRequest>;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

  // =========================================================================
  // Companies
  // =========================================================================

  async listCompanies(ctx: RequestContext): Promise<Company[]> {
    const rows = await this.prisma.company.findMany({
      where: { organizationId: ctx.organizationId, id: { in: ctx.companyIds } },
      orderBy: { code: 'asc' },
      include: { logo: true },
    });
    return rows.map((row) => mapCompany(row));
  }

  async getCompany(ctx: RequestContext, id: string): Promise<Company> {
    return mapCompany(await this.loadCompany(ctx, id));
  }

  async createCompany(ctx: RequestContext, body: CompanyCreate): Promise<Company> {
    if (!ctx.ability.can('create', 'Company')) {
      throw AppError.forbidden('Only an owner or admin may add a legal entity');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          organizationId: ctx.organizationId,
          ...companyWriteData(body),
          code: body.code.toUpperCase(),
          name: body.name,
        },
        include: { logo: true },
      });

      // A new entity with no VAT rates cannot issue a document, so Morocco's
      // standard set is seeded rather than left to the user to discover.
      await tx.vatRate.createMany({
        data: MOROCCAN_VAT.map((vat, index) => ({
          companyId: company.id,
          rate: toPrismaDecimal(vat.rate),
          label: vat.label,
          isDefault: vat.isDefault,
          sortOrder: index,
        })),
      });

      // Owners and admins reach every company implicitly; everyone else needs
      // a grant, and the creator should not lock themselves out.
      const memberships = await tx.membership.findMany({
        where: { organizationId: ctx.organizationId, role: { in: ['OWNER', 'ADMIN'] } },
        select: { id: true },
      });
      await tx.companyAccess.createMany({
        data: memberships.map((membership) => ({
          membershipId: membership.id,
          companyId: company.id,
        })),
        skipDuplicates: true,
      });

      return company;
    });

    return mapCompany(row);
  }

  async updateCompany(ctx: RequestContext, id: string, body: CompanyUpdate): Promise<Company> {
    await this.loadCompany(ctx, id);
    if (!ctx.ability.can('update', 'Company')) {
      throw AppError.forbidden('Your role may not change company settings');
    }

    const row = await this.prisma.company.update({
      where: { id },
      data: companyWriteData(body),
      include: { logo: true },
    });
    return mapCompany(row);
  }

  // =========================================================================
  // VAT rates
  // =========================================================================

  async listVatRates(ctx: RequestContext, companyId: string): Promise<VatRate[]> {
    await this.loadCompany(ctx, companyId);
    const rows = await this.prisma.vatRate.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: 'asc' }, { rate: 'desc' }],
    });
    return rows.map(mapVatRate);
  }

  /**
   * Replace the company's VAT rate list.
   *
   * A rate already used by a validated document is deactivated rather than
   * removed: deleting it would rewrite what that document charged.
   */
  async replaceVatRates(
    ctx: RequestContext,
    companyId: string,
    rates: VatRateInput[],
  ): Promise<VatRate[]> {
    await this.loadCompany(ctx, companyId);
    if (!ctx.ability.can('configure', 'Settings')) {
      throw AppError.forbidden('Your role may not change VAT rates');
    }
    if (rates.filter((rate) => rate.isDefault).length > 1) {
      throw AppError.badRequest('MULTIPLE_DEFAULTS', 'Only one rate can be the default');
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.vatRate.findMany({ where: { companyId } });
      const submitted = new Map(rates.map((rate) => [Number(rate.rate), rate]));

      for (const row of existing) {
        const match = submitted.get(Number(row.rate));
        if (match) {
          await tx.vatRate.update({
            where: { id: row.id },
            data: {
              label: match.label,
              isDefault: match.isDefault,
              isActive: match.isActive,
              sortOrder: match.sortOrder,
            },
          });
          submitted.delete(Number(row.rate));
        } else {
          const inUse = await tx.documentLine.count({
            where: { document: { companyId }, vatRate: row.rate },
          });
          if (inUse > 0) {
            await tx.vatRate.update({ where: { id: row.id }, data: { isActive: false } });
          } else {
            await tx.vatRate.delete({ where: { id: row.id } });
          }
        }
      }

      for (const [, rate] of submitted) {
        await tx.vatRate.create({
          data: {
            companyId,
            rate: toPrismaDecimal(rate.rate),
            label: rate.label,
            isDefault: rate.isDefault,
            isActive: rate.isActive,
            sortOrder: rate.sortOrder,
          },
        });
      }
    });

    return this.listVatRates(ctx, companyId);
  }

  // =========================================================================
  // Numbering
  // =========================================================================

  async listNumberSequences(
    ctx: RequestContext,
    companyId: string,
    year?: number,
  ): Promise<NumberSequence[]> {
    const company = await this.loadCompany(ctx, companyId);
    const targetYear = year ?? new Date().getUTCFullYear();

    const existing = await this.prisma.numberSequence.findMany({
      where: { companyId, year: targetYear },
    });
    const byType = new Map(existing.map((row) => [row.type, row]));

    // Every document type is listed, including ones that have never issued a
    // number, so the settings screen shows the full picture.
    return DOCUMENT_TYPES.map((type) => {
      const row = byType.get(type as DocumentType);
      const prefix = row?.prefix ?? defaultPrefix(type);
      const format = row?.format ?? DEFAULT_NUMBER_FORMAT;
      const counter = row?.counter ?? 0;

      return {
        id: row?.id ?? `${companyId}:${type}:${targetYear}`,
        type,
        year: targetYear,
        prefix,
        format,
        counter,
        nextNumberPreview: formatDocumentNumber(format, {
          prefix,
          sequence: counter + 1,
          year: targetYear,
          month: new Date().getUTCMonth() + 1,
          companyCode: company.code,
        }),
      };
    });
  }

  async updateNumberSequence(
    ctx: RequestContext,
    companyId: string,
    sequenceId: string,
    body: NumberSequenceUpdate,
  ): Promise<NumberSequence> {
    const company = await this.loadCompany(ctx, companyId);
    if (!ctx.ability.can('configure', 'Settings')) {
      throw AppError.forbidden('Your role may not change numbering');
    }

    // The list returns synthetic ids for sequences that do not exist yet, so a
    // first edit has to create the row.
    const synthetic = sequenceId.split(':');
    const isSynthetic = synthetic.length === 3 && synthetic[0] === companyId;

    const existing = isSynthetic
      ? await this.prisma.numberSequence.findUnique({
          where: {
            companyId_type_year: {
              companyId,
              type: synthetic[1] as DocumentType,
              year: Number(synthetic[2]),
            },
          },
        })
      : await this.prisma.numberSequence.findFirst({ where: { id: sequenceId, companyId } });

    const type = (existing?.type ?? (synthetic[1] as DocumentType)) as DocumentType;
    const year = existing?.year ?? Number(synthetic[2]);

    if (!type || !Number.isInteger(year)) throw AppError.notFound('Number sequence', sequenceId);

    // Moving the counter after numbers have been issued would create duplicates
    // or holes, both of which an audit will ask about.
    if (body.counter !== undefined && (existing?.counter ?? 0) > 0) {
      throw AppError.conflict(
        'SEQUENCE_IN_USE',
        `${type} numbers have already been issued for ${year}; the counter can no longer be moved`,
      );
    }

    const row = existing
      ? await this.prisma.numberSequence.update({
          where: { id: existing.id },
          data: {
            ...(body.prefix ? { prefix: body.prefix } : {}),
            ...(body.format ? { format: body.format } : {}),
            ...(body.counter !== undefined ? { counter: body.counter } : {}),
          },
        })
      : await this.prisma.numberSequence.create({
          data: {
            companyId,
            type,
            year,
            prefix: body.prefix ?? defaultPrefix(type),
            format: body.format ?? DEFAULT_NUMBER_FORMAT,
            counter: body.counter ?? 0,
          },
        });

    return {
      id: row.id,
      type: row.type,
      year: row.year,
      prefix: row.prefix,
      format: row.format,
      counter: row.counter,
      nextNumberPreview: formatDocumentNumber(row.format, {
        prefix: row.prefix,
        sequence: row.counter + 1,
        year: row.year,
        month: new Date().getUTCMonth() + 1,
        companyCode: company.code,
      }),
    };
  }

  // =========================================================================
  // Members
  // =========================================================================

  async listMembers(ctx: RequestContext): Promise<Membership[]> {
    if (!ctx.ability.can('read', 'Membership')) {
      throw AppError.forbidden('Your role may not see the team');
    }

    const rows = await this.prisma.membership.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: 'asc' },
      include: { user: true, companyAccess: { select: { companyId: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      email: row.user.email,
      username: row.user.username,
      fullName: row.user.fullName,
      role: row.role,
      companyIds: row.companyAccess.map((access) => access.companyId),
      isActive: row.user.isActive,
      lastLoginAt: row.user.lastLoginAt?.toISOString() ?? null,
    }));
  }

  async inviteMember(ctx: RequestContext, body: MembershipInvite): Promise<Membership> {
    if (!ctx.ability.can('create', 'Membership')) {
      throw AppError.forbidden('Your role may not add team members');
    }
    if (body.role === 'OWNER' && ctx.role !== 'OWNER') {
      throw AppError.forbidden('Only an owner can appoint another owner');
    }

    const allowed = body.companyIds.filter((id) => ctx.companyIds.includes(id));
    if (allowed.length !== body.companyIds.length) {
      throw AppError.forbidden('You cannot grant access to a company you have none to');
    }

    const email = body.email.toLowerCase().trim();
    const username = body.username ? body.username.toLowerCase().trim() : null;

    const membership = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { email } });
      if (existingUser) {
        const already = await tx.membership.findUnique({
          where: { userId_organizationId: { userId: existingUser.id, organizationId: ctx.organizationId } },
        });
        if (already) {
          throw AppError.conflict('ALREADY_MEMBER', `${email} is already in this organization`);
        }
      }

      if (username && !existingUser) await assertUsernameFree(tx, username);

      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            email,
            username,
            fullName: body.fullName,
            passwordHash: await hashPassword(body.password),
          },
        }));

      return tx.membership.create({
        data: {
          userId: user.id,
          organizationId: ctx.organizationId,
          role: body.role,
          companyAccess: { create: allowed.map((companyId) => ({ companyId })) },
        },
        include: { user: true, companyAccess: { select: { companyId: true } } },
      });
    });

    return {
      id: membership.id,
      userId: membership.userId,
      email: membership.user.email,
      username: membership.user.username,
      fullName: membership.user.fullName,
      role: membership.role,
      companyIds: membership.companyAccess.map((access) => access.companyId),
      isActive: membership.user.isActive,
      lastLoginAt: null,
    };
  }

  async updateMember(
    ctx: RequestContext,
    id: string,
    body: MembershipUpdate,
  ): Promise<Membership> {
    const existing = await this.prisma.membership.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: { user: true },
    });
    if (!existing) throw AppError.notFound('Member', id);

    if (!ctx.ability.can('update', 'Membership')) {
      throw AppError.forbidden('Your role may not change team members');
    }
    if ((existing.role === 'OWNER' || body.role === 'OWNER') && ctx.role !== 'OWNER') {
      throw AppError.forbidden('Only an owner can change an owner');
    }
    // Removing the last owner would leave nobody able to administer the account.
    if (existing.role === 'OWNER' && body.role && body.role !== 'OWNER') {
      const owners = await this.prisma.membership.count({
        where: { organizationId: ctx.organizationId, role: 'OWNER' },
      });
      if (owners <= 1) {
        throw AppError.conflict('LAST_OWNER', 'An organization must keep at least one owner');
      }
    }

    const membership = await this.prisma.$transaction(async (tx) => {
      if (body.role) {
        await tx.membership.update({ where: { id }, data: { role: body.role } });
      }
      if (body.companyIds) {
        const allowed = body.companyIds.filter((companyId) => ctx.companyIds.includes(companyId));
        await tx.companyAccess.deleteMany({ where: { membershipId: id } });
        await tx.companyAccess.createMany({
          data: allowed.map((companyId) => ({ membershipId: id, companyId })),
          skipDuplicates: true,
        });
      }
      if (body.username !== undefined) {
        const next = body.username ? body.username.toLowerCase().trim() : null;
        if (next) await assertUsernameFree(tx, next, existing.userId);
        await tx.user.update({ where: { id: existing.userId }, data: { username: next } });
      }
      if (body.isActive !== undefined) {
        await tx.user.update({ where: { id: existing.userId }, data: { isActive: body.isActive } });
        if (!body.isActive) {
          // Deactivating someone must end their sessions, not just hide them.
          await tx.refreshToken.updateMany({
            where: { userId: existing.userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      }

      return tx.membership.findUniqueOrThrow({
        where: { id },
        include: { user: true, companyAccess: { select: { companyId: true } } },
      });
    });

    return {
      id: membership.id,
      userId: membership.userId,
      email: membership.user.email,
      username: membership.user.username,
      fullName: membership.user.fullName,
      role: membership.role,
      companyIds: membership.companyAccess.map((access) => access.companyId),
      isActive: membership.user.isActive,
      lastLoginAt: membership.user.lastLoginAt?.toISOString() ?? null,
    };
  }

  async removeMember(ctx: RequestContext, id: string): Promise<void> {
    const existing = await this.prisma.membership.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!existing) throw AppError.notFound('Member', id);
    if (!ctx.ability.can('delete', 'Membership')) {
      throw AppError.forbidden('Your role may not remove team members');
    }
    if (existing.userId === ctx.userId) {
      throw AppError.badRequest('CANNOT_REMOVE_SELF', 'You cannot remove your own membership');
    }
    if (existing.role === 'OWNER' && ctx.role !== 'OWNER') {
      throw AppError.forbidden('Only an owner can remove an owner');
    }

    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.membership.delete({ where: { id } }),
    ]);
  }

  // =========================================================================
  // Template configurator
  // =========================================================================

  async listTemplates(
    ctx: RequestContext,
    documentType?: DocumentType,
  ): Promise<TemplateConfig[]> {
    const rows = await this.prisma.templateConfig.findMany({
      where: {
        companyId: ctx.companyId,
        ...(documentType ? { OR: [{ documentType }, { documentType: null }] } : {}),
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });

    // A company with no saved template still has one: the built-in default,
    // surfaced so the configurator always has something to open.
    if (rows.length === 0) {
      return [
        {
          id: 'default',
          companyId: ctx.companyId,
          name: 'Default',
          documentType: null,
          isDefault: true,
          version: 1,
          config: DEFAULT_TEMPLATE_CONFIG,
        },
      ];
    }

    return rows.map(mapTemplate);
  }

  async getTemplate(ctx: RequestContext, id: string): Promise<TemplateConfig> {
    if (id === 'default') {
      return {
        id: 'default',
        companyId: ctx.companyId,
        name: 'Default',
        documentType: null,
        isDefault: true,
        version: 1,
        config: DEFAULT_TEMPLATE_CONFIG,
      };
    }
    const row = await this.prisma.templateConfig.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!row) throw AppError.notFound('Template', id);
    return mapTemplate(row);
  }

  async createTemplate(
    ctx: RequestContext,
    body: TemplateConfigCreate,
  ): Promise<TemplateConfig> {
    this.assertCanConfigureTemplates(ctx);

    const row = await this.prisma.$transaction(async (tx) => {
      if (body.isDefault) await this.clearDefault(tx, ctx.companyId, body.documentType ?? null);
      return tx.templateConfig.create({
        data: {
          companyId: ctx.companyId,
          name: body.name,
          documentType: body.documentType ?? null,
          isDefault: body.isDefault,
          config: withDefaults(body.config) as unknown as Prisma.InputJsonValue,
        },
      });
    });

    return mapTemplate(row);
  }

  /**
   * Save a template.
   *
   * Every save bumps `version`. Rendered PDFs are keyed by a hash that includes
   * the config, so a document already printed keeps its file and its look while
   * new documents pick up the change.
   */
  async updateTemplate(
    ctx: RequestContext,
    id: string,
    body: TemplateConfigUpdate,
  ): Promise<TemplateConfig> {
    this.assertCanConfigureTemplates(ctx);

    if (id === 'default') {
      // Editing the built-in default materialises it as a real row.
      return this.createTemplate(ctx, {
        name: body.name ?? 'Default',
        documentType: body.documentType ?? null,
        isDefault: true,
        config: withDefaults(body.config ?? DEFAULT_TEMPLATE_CONFIG),
      });
    }

    const existing = await this.prisma.templateConfig.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw AppError.notFound('Template', id);

    const row = await this.prisma.$transaction(async (tx) => {
      const targetType = body.documentType ?? existing.documentType;
      if (body.isDefault) await this.clearDefault(tx, ctx.companyId, targetType, id);

      return tx.templateConfig.update({
        where: { id },
        data: {
          ...(body.name ? { name: body.name } : {}),
          ...(body.documentType !== undefined ? { documentType: body.documentType ?? null } : {}),
          ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
          ...(body.config
            ? {
                config: withDefaults(body.config) as unknown as Prisma.InputJsonValue,
                version: { increment: 1 },
              }
            : {}),
        },
      });
    });

    return mapTemplate(row);
  }

  async removeTemplate(ctx: RequestContext, id: string): Promise<void> {
    this.assertCanConfigureTemplates(ctx);
    const existing = await this.prisma.templateConfig.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw AppError.notFound('Template', id);

    // Documents keep pointing at the template they were issued under, so the
    // reference is cleared rather than the documents being touched.
    await this.prisma.$transaction([
      this.prisma.document.updateMany({
        where: { templateConfigId: id },
        data: { templateConfigId: null },
      }),
      this.prisma.templateConfig.delete({ where: { id } }),
    ]);
  }

  async previewTemplate(
    ctx: RequestContext,
    body: TemplatePreviewRequest,
  ): Promise<{ html: string; pageCountEstimate: number }> {
    return this.pdf.preview(ctx, {
      config: withDefaults(body.config),
      documentId: body.documentId ?? null,
      documentType: body.documentType,
      locale: body.locale,
      sampleLineCount: body.sampleLineCount,
    });
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private assertCanConfigureTemplates(ctx: RequestContext): void {
    if (!ctx.ability.can('configure', 'TemplateConfig')) {
      throw AppError.forbidden('Your role may not change document templates');
    }
  }

  private async clearDefault(
    tx: Prisma.TransactionClient,
    companyId: string,
    documentType: DocumentType | null,
    exceptId?: string,
  ): Promise<void> {
    await tx.templateConfig.updateMany({
      where: {
        companyId,
        documentType,
        isDefault: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isDefault: false },
    });
  }

  private async loadCompany(ctx: RequestContext, id: string) {
    // A company the member has no grant to is a 404, not a 403: they should not
    // learn that a legal entity with that id exists.
    if (!ctx.companyIds.includes(id)) throw AppError.notFound('Company', id);

    const company = await this.prisma.company.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: { logo: true },
    });
    if (!company) throw AppError.notFound('Company', id);
    return company;
  }
}

const MOROCCAN_VAT = [
  { rate: '20', label: 'TVA 20%', isDefault: true },
  { rate: '14', label: 'TVA 14%', isDefault: false },
  { rate: '10', label: 'TVA 10%', isDefault: false },
  { rate: '7', label: 'TVA 7%', isDefault: false },
  { rate: '0', label: 'Exonéré', isDefault: false },
];

function companyWriteData(body: CompanyUpdate) {
  const set = <T>(value: T | undefined, key: string) =>
    value !== undefined ? { [key]: value } : {};

  return {
    ...set(body.code?.toUpperCase(), 'code'),
    ...set(body.name, 'name'),
    ...set(body.legalName, 'legalName'),
    ...set(body.legalForm, 'legalForm'),
    ...set(body.ice, 'ice'),
    ...set(body.rc, 'rc'),
    ...set(body.taxId, 'taxId'),
    ...set(body.patente, 'patente'),
    ...set(body.cnss, 'cnss'),
    ...(body.shareCapital !== undefined
      ? { shareCapital: toPrismaDecimalOrNull(body.shareCapital) }
      : {}),
    ...set(body.email, 'email'),
    ...set(body.phone, 'phone'),
    ...set(body.phone2, 'phone2'),
    ...set(body.website, 'website'),
    ...set(body.addressLine1, 'addressLine1'),
    ...set(body.addressLine2, 'addressLine2'),
    ...set(body.city, 'city'),
    ...set(body.postalCode, 'postalCode'),
    ...set(body.country, 'country'),
    ...set(body.bankName, 'bankName'),
    ...set(body.iban, 'iban'),
    ...set(body.rib, 'rib'),
    ...set(body.swift, 'swift'),
    ...set(body.logoAssetId, 'logoAssetId'),
    ...set(body.defaultCurrency, 'defaultCurrency'),
    ...set(body.defaultLocale, 'defaultLocale'),
    ...set(body.priceMode, 'priceMode'),
    ...set(body.roundingMode, 'roundingMode'),
    ...set(body.roundingScale, 'roundingScale'),
    ...set(body.roundingGranularity, 'roundingGranularity'),
    ...set(body.negativeStockPolicy, 'negativeStockPolicy'),
    ...set(body.defaultWarehouseId, 'defaultWarehouseId'),
    ...set(body.posEnabled, 'posEnabled'),
    ...set(body.posRequireSession, 'posRequireSession'),
  };
}

function mapCompany(
  row: Prisma.CompanyGetPayload<{ include: { logo: true } }>,
): Company {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    legalName: row.legalName,
    ice: row.ice,
    rc: row.rc,
    taxId: row.taxId,
    patente: row.patente,
    cnss: row.cnss,
    shareCapital: nullableMoneyOut(row.shareCapital),
    legalForm: row.legalForm,
    email: row.email,
    phone: row.phone,
    phone2: row.phone2,
    website: row.website,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    postalCode: row.postalCode,
    country: row.country,
    bankName: row.bankName,
    iban: row.iban,
    rib: row.rib,
    swift: row.swift,
    logoAssetId: row.logoAssetId,
    logoUrl: null,
    defaultCurrency: row.defaultCurrency,
    defaultLocale: row.defaultLocale,
    priceMode: row.priceMode,
    roundingMode: row.roundingMode,
    roundingScale: row.roundingScale,
    roundingGranularity: row.roundingGranularity,
    negativeStockPolicy: row.negativeStockPolicy,
    defaultWarehouseId: row.defaultWarehouseId,
    posEnabled: row.posEnabled,
    posRequireSession: row.posRequireSession,
    isActive: row.isActive,
  };
}

function mapVatRate(row: Prisma.VatRateGetPayload<object>): VatRate {
  return {
    id: row.id,
    rate: rateOut(row.rate),
    label: row.label,
    isDefault: row.isDefault,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

function mapTemplate(row: Prisma.TemplateConfigGetPayload<object>): TemplateConfig {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    documentType: row.documentType,
    isDefault: row.isDefault,
    version: row.version,
    config: withDefaults(row.config),
  };
}

async function assertUsernameFree(
  tx: { user: { findUnique: (args: { where: { username: string } }) => Promise<{ id: string } | null> } },
  username: string,
  exceptUserId?: string,
): Promise<void> {
  const taken = await tx.user.findUnique({ where: { username } });
  if (taken && taken.id !== exceptUserId) {
    throw AppError.conflict('USERNAME_TAKEN', `The username "${username}" is already taken`);
  }
}
