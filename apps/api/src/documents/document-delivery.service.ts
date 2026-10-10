import { Injectable } from '@nestjs/common';
import { subject } from '@mizmar/core';
import type { Locale } from '@mizmar/i18n';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { MailService } from '../mail/mail.service';
import { PdfService, type RenderedPdf } from '../pdf/pdf.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

/**
 * Getting a document out of the system: as a PDF, or as an email with that
 * PDF attached.
 *
 * Separate from DocumentsService, which owns the document's state, because
 * delivery touches Chromium, object storage and SMTP — none of which belong
 * on the transaction path that validates a document.
 */
@Injectable()
export class DocumentDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly mail: MailService,
    private readonly whatsapp: WhatsappService,
  ) {}

  async renderPdf(
    ctx: RequestContext,
    documentId: string,
    body: { locale?: Locale | null; templateConfigId?: string | null; forceRerender: boolean },
  ): Promise<RenderedPdf> {
    await this.assertCanRead(ctx, documentId);
    return this.pdf.render(ctx, documentId, {
      locale: body.locale ?? undefined,
      templateConfigId: body.templateConfigId ?? undefined,
      forceRerender: body.forceRerender,
    });
  }

  /**
   * Email the document to the client and mark it sent.
   *
   * Sending is what turns Validated into Sent, so the status reflects something
   * that actually happened rather than a button someone remembered to press.
   */
  async sendByEmail(
    ctx: RequestContext,
    documentId: string,
    body: {
      to: string[];
      cc?: string[];
      subject: string;
      body: string;
      locale?: Locale | null;
      attachPdf: boolean;
    },
  ): Promise<void> {
    const document = await this.assertCanSend(ctx, documentId);

    if (document.lifecycle === 'DRAFT') {
      throw AppError.conflict(
        'NOT_VALIDATED',
        'Validate the document before sending it, so it carries a real number',
      );
    }

    const attachments = body.attachPdf
      ? await (async () => {
          const { bytes, fileName } = await this.pdf.renderBytes(ctx, documentId, {
            locale: body.locale ?? undefined,
          });
          return [{ filename: fileName, content: bytes, contentType: 'application/pdf' }];
        })()
      : undefined;

    await this.mail.send({
      to: body.to,
      cc: body.cc,
      subject: body.subject,
      body: body.body,
      attachments,
      replyTo: ctx.email,
    });

    await this.prisma.document.update({
      where: { id: documentId },
      data: { lifecycle: 'SENT', sentAt: document.sentAt ?? new Date() },
    });
  }

  /**
   * Send the document to the customer on WhatsApp, with the PDF attached.
   * Like email, a successful send is what moves Validated to Sent.
   */
  async sendByWhatsapp(
    ctx: RequestContext,
    documentId: string,
    body: {
      phone: string;
      message: string;
      locale?: Locale | null;
      attachPdf: boolean;
      savePhoneToContact: boolean;
    },
  ): Promise<void> {
    const document = await this.assertCanSend(ctx, documentId);

    if (document.lifecycle === 'DRAFT') {
      throw AppError.conflict(
        'NOT_VALIDATED',
        'Validate the document before sending it, so it carries a real number',
      );
    }

    // Parse first so a typo fails before a PDF is rendered.
    const phone = this.whatsapp.parsePhone(body.phone);

    const file = body.attachPdf
      ? await (async () => {
          const { bytes, fileName } = await this.pdf.renderBytes(ctx, documentId, {
            locale: body.locale ?? undefined,
          });
          return { bytes, filename: fileName, mimetype: 'application/pdf' };
        })()
      : undefined;

    await this.whatsapp.send(phone, body.message, file);

    await this.prisma.document.update({
      where: { id: documentId },
      data: { lifecycle: 'SENT', sentAt: document.sentAt ?? new Date() },
    });

    if (body.savePhoneToContact) {
      await this.prisma.contact.updateMany({
        where: { id: document.contactId, phone: null },
        data: { phone: body.phone.trim() },
      });
    }
  }

  private async assertCanRead(ctx: RequestContext, documentId: string) {
    const document = await this.load(ctx, documentId);
    if (
      !ctx.ability.can(
        'read',
        subject('Document', {
          companyId: document.companyId,
          side: document.side,
          type: document.type,
          lifecycle: document.lifecycle,
          createdById: document.createdById ?? '',
        }),
      )
    ) {
      throw AppError.forbidden('Your role may not read this document');
    }
    return document;
  }

  private async assertCanSend(ctx: RequestContext, documentId: string) {
    const document = await this.load(ctx, documentId);
    if (
      !ctx.ability.can(
        'send',
        subject('Document', {
          companyId: document.companyId,
          side: document.side,
          type: document.type,
          lifecycle: document.lifecycle,
          createdById: document.createdById ?? '',
        }),
      )
    ) {
      throw AppError.forbidden('Your role may not send this document');
    }
    return document;
  }

  private async load(ctx: RequestContext, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, companyId: { in: ctx.companyIds } },
      select: {
        id: true,
        companyId: true,
        side: true,
        type: true,
        lifecycle: true,
        createdById: true,
        sentAt: true,
        contactId: true,
      },
    });
    if (!document) throw AppError.notFound('Document', documentId);
    return document;
  }
}
