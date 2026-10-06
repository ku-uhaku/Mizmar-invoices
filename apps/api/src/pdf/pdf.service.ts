import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type DocumentType, type Locale as PrismaLocale } from '@prisma/client';
import { dec, outstandingAmount } from '@mizmar/core';
import {
  DEFAULT_TEMPLATE_CONFIG,
  estimatePageCount,
  renderDocumentHtml,
  renderPdfFooterTemplate,
  renderPdfHeaderTemplate,
  SAMPLE_DOCUMENT,
  sampleWithLineCount,
  withDefaults,
  type RenderData,
  type TemplateConfigBody,
} from '@mizmar/doc-template';
import type { Locale } from '@mizmar/i18n';
import { AppError } from '../common/app-error';
import { moneyOut, nullableQtyOut, qtyOut, rateOut } from '../common/util/decimal';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { RequestContext } from '../tenancy/request-context';
import { ChromiumService } from './chromium.service';
import { documentInclude, type DocumentWithRelations } from '../documents/document-include';

export interface RenderedPdf {
  documentId: string;
  snapshotVersion: number;
  url: string;
  fileName: string;
  byteSize: number;
  cached: boolean;
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly chromium: ChromiumService,
  ) {}

  // =========================================================================
  // Live preview for the configurator
  // =========================================================================

  /**
   * Render preview HTML without saving anything.
   *
   * Returns the same HTML the PDF is produced from, which the configurator
   * drops into an iframe. That shared code path is what makes the preview
   * trustworthy rather than an approximation of the print output.
   */
  async preview(
    ctx: RequestContext,
    input: {
      config: TemplateConfigBody;
      documentId?: string | null;
      documentType: DocumentType;
      locale?: Locale;
      sampleLineCount?: number;
    },
  ): Promise<{ html: string; pageCountEstimate: number }> {
    const config = withDefaults(input.config);

    const data = input.documentId
      ? await this.buildRenderData(ctx, input.documentId)
      : this.sampleData(input.documentType, input.sampleLineCount);

    const locale = input.locale ?? config.localeOptions.locale;
    const pageCountEstimate = estimatePageCount(data, config);

    return {
      html: renderDocumentHtml(data, config, locale, { estimatedPageCount: pageCountEstimate }),
      pageCountEstimate,
    };
  }

  private sampleData(documentType: DocumentType, lineCount?: number): RenderData {
    const base = lineCount ? sampleWithLineCount(lineCount) : SAMPLE_DOCUMENT;
    return { ...base, document: { ...base.document, type: documentType } };
  }

  // =========================================================================
  // PDF rendering, with reproducible reprints
  // =========================================================================

  /**
   * Produce (or reuse) the PDF for a document.
   *
   * A snapshot records the payload and a hash of the template it was rendered
   * under. Asking again returns the stored file, so reprinting last year's
   * invoice gives last year's design even after the branding changed.
   * Re-rendering under the current template is an explicit `forceRerender`.
   */
  async render(
    ctx: RequestContext,
    documentId: string,
    options: { locale?: Locale; templateConfigId?: string | null; forceRerender?: boolean } = {},
  ): Promise<RenderedPdf> {
    const document = await this.loadDocument(ctx, documentId);
    const { config, templateConfigId } = await this.resolveTemplate(
      document.companyId,
      document.type,
      options.templateConfigId ?? document.templateConfigId,
    );

    const locale =
      options.locale ??
      (document.locale as Locale | null) ??
      (config.localeOptions.locale as Locale);

    const data = await this.buildRenderData(ctx, documentId, document);
    const payload = data as unknown as Prisma.InputJsonValue;
    const hash = hashRender(data, config, locale);

    const existing = await this.prisma.documentSnapshot.findFirst({
      where: { documentId, templateConfigHash: hash, locale: locale as PrismaLocale },
      orderBy: { version: 'desc' },
    });

    const fileName = buildFileName(document.number, document.type, locale);

    if (!options.forceRerender && existing?.pdfStorageKey) {
      if (await this.storage.exists('documents', existing.pdfStorageKey)) {
        return {
          documentId,
          snapshotVersion: existing.version,
          url: await this.storage.signedUrl('documents', existing.pdfStorageKey, {
            downloadName: fileName,
          }),
          fileName,
          byteSize: existing.pdfByteSize ?? 0,
          cached: true,
        };
      }
    }

    if (!this.chromium.isAvailable()) {
      throw AppError.unprocessable(
        'PDF_ENGINE_UNAVAILABLE',
        'PDF rendering needs Chromium. Set CHROMIUM_PATH, or use the browser print dialog from the preview.',
      );
    }

    const html = renderDocumentHtml(data, config, locale, { forPdf: true });

    const bytes = await this.chromium.renderPdf(html, {
      headerTemplate: renderPdfHeaderTemplate(),
      footerTemplate: renderPdfFooterTemplate(config, locale),
      marginTopMm: config.layout.marginTopMm,
      marginRightMm: config.layout.marginRightMm,
      marginBottomMm: config.layout.marginBottomMm,
      marginLeftMm: config.layout.marginLeftMm,
      landscape: config.layout.orientation === 'LANDSCAPE',
      pageSize: config.layout.pageSize,
    });

    const storageKey = `${ctx.organizationId}/${documentId}/${hash.slice(0, 16)}.pdf`;
    await this.storage.put('documents', storageKey, bytes, 'application/pdf');

    const nextVersion =
      existing?.version ??
      ((
        await this.prisma.documentSnapshot.aggregate({
          where: { documentId },
          _max: { version: true },
        })
      )._max?.version ?? 0) + 1;

    const snapshot = await this.prisma.documentSnapshot.upsert({
      where: { documentId_version: { documentId, version: nextVersion } },
      update: {
        payload,
        templateConfigHash: hash,
        templateConfigId,
        locale: locale as PrismaLocale,
        pdfStorageKey: storageKey,
        pdfRenderedAt: new Date(),
        pdfByteSize: bytes.byteLength,
      },
      create: {
        documentId,
        version: nextVersion,
        payload,
        templateConfigHash: hash,
        templateConfigId,
        locale: locale as PrismaLocale,
        pdfStorageKey: storageKey,
        pdfRenderedAt: new Date(),
        pdfByteSize: bytes.byteLength,
      },
    });

    this.logger.log(
      `Rendered ${fileName} (${(bytes.byteLength / 1024).toFixed(0)} KB, v${snapshot.version})`,
    );

    return {
      documentId,
      snapshotVersion: snapshot.version,
      url: await this.storage.signedUrl('documents', storageKey, { downloadName: fileName }),
      fileName,
      byteSize: bytes.byteLength,
      cached: false,
    };
  }

  /** The raw bytes, for emailing the document as an attachment. */
  async renderBytes(
    ctx: RequestContext,
    documentId: string,
    options: { locale?: Locale } = {},
  ): Promise<{ bytes: Buffer; fileName: string }> {
    const rendered = await this.render(ctx, documentId, options);
    const snapshot = await this.prisma.documentSnapshot.findFirstOrThrow({
      where: { documentId, version: rendered.snapshotVersion },
      select: { pdfStorageKey: true },
    });
    if (!snapshot.pdfStorageKey) throw AppError.notFound('Rendered PDF');
    return {
      bytes: await this.storage.get('documents', snapshot.pdfStorageKey),
      fileName: rendered.fileName,
    };
  }

  // =========================================================================
  // Template resolution
  // =========================================================================

  /**
   * Pick the template to render with: an explicit one, else the company's
   * default for this document type, else its global default, else the built-in.
   * A quote and an invoice can legitimately look different, which is why the
   * per-type default is checked first.
   */
  async resolveTemplate(
    companyId: string,
    documentType: DocumentType,
    explicitId?: string | null,
  ): Promise<{ config: TemplateConfigBody; templateConfigId: string | null }> {
    if (explicitId) {
      const row = await this.prisma.templateConfig.findFirst({
        where: { id: explicitId, companyId },
      });
      if (row) return { config: withDefaults(row.config), templateConfigId: row.id };
    }

    const perType = await this.prisma.templateConfig.findFirst({
      where: { companyId, documentType, isDefault: true },
    });
    if (perType) return { config: withDefaults(perType.config), templateConfigId: perType.id };

    const global = await this.prisma.templateConfig.findFirst({
      where: { companyId, documentType: null, isDefault: true },
    });
    if (global) return { config: withDefaults(global.config), templateConfigId: global.id };

    return { config: DEFAULT_TEMPLATE_CONFIG, templateConfigId: null };
  }

  // =========================================================================
  // Building the render payload
  // =========================================================================

  private async loadDocument(
    ctx: RequestContext,
    documentId: string,
  ): Promise<DocumentWithRelations> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, companyId: { in: ctx.companyIds } },
      include: documentInclude,
    });
    if (!document) throw AppError.notFound('Document', documentId);
    return document;
  }

  private async buildRenderData(
    ctx: RequestContext,
    documentId: string,
    preloaded?: DocumentWithRelations,
  ): Promise<RenderData> {
    const document = preloaded ?? (await this.loadDocument(ctx, documentId));

    const [company, contact, warehouse] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: document.companyId },
        include: { logo: true },
      }),
      this.prisma.contact.findUniqueOrThrow({
        where: { id: document.contactId },
        include: { addresses: true },
      }),
      document.warehouseId
        ? this.prisma.warehouse.findUnique({
            where: { id: document.warehouseId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);

    // Images are inlined as data URIs so the PDF is self-contained: a logo
    // fetched over the network would make a reprint depend on storage still
    // serving that URL years later.
    const logoUrl = company.logo ? await this.inlineAsset(company.logo.storageKey, company.logo.contentType) : null;

    const billing =
      contact.addresses.find((address) => address.id === document.billingAddressId) ??
      contact.addresses.find((address) => address.kind === 'BILLING' && address.isDefault) ??
      contact.addresses.find((address) => address.kind === 'BILLING') ??
      null;

    const shipping =
      contact.addresses.find((address) => address.id === document.shippingAddressId) ??
      contact.addresses.find((address) => address.kind === 'SHIPPING' && address.isDefault) ??
      null;

    const vatBuckets =
      (document.vatBreakdown as Array<{ rate: string; base: string; amount: string }> | null) ?? [];

    return {
      company: {
        name: company.name,
        legalName: company.legalName,
        legalForm: company.legalForm,
        ice: company.ice,
        rc: company.rc,
        taxId: company.taxId,
        patente: company.patente,
        cnss: company.cnss,
        shareCapital: company.shareCapital ? moneyOut(company.shareCapital) : null,
        email: company.email,
        phone: company.phone,
        phone2: company.phone2,
        website: company.website,
        address: company.addressLine1
          ? {
              addressLine1: company.addressLine1,
              addressLine2: company.addressLine2,
              city: company.city,
              postalCode: company.postalCode,
              country: company.country,
            }
          : null,
        bankName: company.bankName,
        iban: company.iban,
        rib: company.rib,
        swift: company.swift,
        logoUrl,
        stampUrl: null,
        signatureUrl: null,
      },
      contact: {
        displayName: contact.displayName,
        legalName: contact.legalName,
        ice: contact.ice,
        rc: contact.rc,
        taxId: contact.taxId,
        email: contact.email,
        phone: contact.phone,
        billingAddress: billing
          ? {
              addressLine1: billing.addressLine1,
              addressLine2: billing.addressLine2,
              city: billing.city,
              postalCode: billing.postalCode,
              country: billing.country,
            }
          : null,
        shippingAddress: shipping
          ? {
              addressLine1: shipping.addressLine1,
              addressLine2: shipping.addressLine2,
              city: shipping.city,
              postalCode: shipping.postalCode,
              country: shipping.country,
            }
          : null,
      },
      document: {
        type: document.type,
        number: document.number,
        issueDate: document.issueDate.toISOString().slice(0, 10),
        dueDate: document.dueDate?.toISOString().slice(0, 10) ?? null,
        validUntil: document.validUntil?.toISOString().slice(0, 10) ?? null,
        deliveryDate: document.deliveryDate?.toISOString().slice(0, 10) ?? null,
        reference: document.reference,
        projectName: document.projectName,
        currency: document.currency,
        notes: document.notes,
        terms: document.terms,
        paidAmount: moneyOut(document.paidAmount),
        outstandingAmount: outstandingAmount(
          dec(document.totalInclVat.toFixed()).toFixed(),
          dec(document.paidAmount.toFixed()).toFixed(),
        ),
        lines: document.lines.map((line) => ({
          sku: line.sku ?? line.variant?.sku ?? null,
          barcode: line.variant?.barcode ?? null,
          description: line.description,
          variantLabel: line.variantLabel ?? line.variant?.variantLabel ?? null,
          unitCode: line.unitCode,
          imageUrl: null,
          quantity: qtyOut(line.quantity),
          unitPrice: qtyOut(line.unitPrice),
          discountKind: line.discountKind,
          discountValue: nullableQtyOut(line.discountValue),
          lineDiscount: moneyOut(line.lineDiscount),
          vatRate: rateOut(line.vatRate),
          vatAmount: moneyOut(line.vatAmount),
          taxableBase: moneyOut(line.taxableBase),
          lineTotal: moneyOut(line.lineTotal),
          // The upstream delivery note, for the optional "Réf. BL" column.
          sourceReference: line.sources[0]?.sourceLine.document.number ?? null,
          isNote: line.isNote,
        })),
        totals: {
          subtotalGross: moneyOut(document.subtotalGross),
          totalLineDiscounts: moneyOut(document.totalLineDiscounts),
          subtotalNet: moneyOut(document.subtotalNet),
          globalDiscount: moneyOut(document.globalDiscount),
          shippingNet: moneyOut(document.shippingAmount ?? 0),
          totalExclVat: moneyOut(document.totalExclVat),
          totalVat: moneyOut(document.totalVat),
          totalInclVat: moneyOut(document.totalInclVat),
          vatBuckets,
        },
      },
      warehouseName: warehouse?.name ?? null,
      salespersonName: document.createdBy?.fullName ?? null,
      // A draft or cancelled document must never be mistaken for a real one.
      watermark:
        document.lifecycle === 'DRAFT'
          ? 'DRAFT'
          : document.lifecycle === 'CANCELLED'
            ? 'CANCELLED'
            : null,
    };
  }

  private async inlineAsset(storageKey: string, contentType: string): Promise<string | null> {
    try {
      const bytes = await this.storage.get('assets', storageKey);
      return `data:${contentType};base64,${bytes.toString('base64')}`;
    } catch (error) {
      this.logger.warn(
        `Could not inline asset ${storageKey}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }
}

/**
 * Identity of a rendered PDF: the payload, the style and the language.
 * Any change to any of them is a different document and earns a new file.
 */
function hashRender(data: RenderData, config: TemplateConfigBody, locale: Locale): string {
  return createHash('sha256')
    .update(JSON.stringify({ data, config, locale }))
    .digest('hex');
}

function buildFileName(
  number: string | null,
  type: DocumentType,
  locale: Locale,
): string {
  const base = (number ?? `${type}-draft`).replace(/[^\w.-]+/g, '-');
  return `${base}-${locale.toLowerCase()}.pdf`;
}
