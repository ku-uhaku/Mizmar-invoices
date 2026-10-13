import { describe, expect, it, vi } from 'vitest';
import { DocumentDeliveryService } from './document-delivery.service';

function setup(lifecycle: 'DRAFT' | 'VALIDATED' = 'VALIDATED', canSend = true) {
  const document = {
    id: 'd1',
    companyId: 'c1',
    side: 'SALES',
    type: 'SALES_INVOICE',
    lifecycle,
    createdById: 'u1',
    sentAt: null,
    contactId: 'k1',
  };
  const prisma = {
    document: {
      findFirst: vi.fn(async () => document),
      update: vi.fn(async () => ({})),
    },
    contact: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const pdf = {
    renderBytes: vi.fn(async () => ({ bytes: Buffer.from('%PDF'), fileName: 'F-1.pdf' })),
  };
  const mail = { send: vi.fn() };
  const whatsapp = {
    // Mirrors the real parsePhone enough to exercise ordering.
    parsePhone: vi.fn((raw: string) => {
      if (!/\d{8}/.test(raw.replace(/\D/g, ''))) throw new Error('INVALID_PHONE');
      return raw.replace(/\D/g, '');
    }),
    send: vi.fn(async () => undefined),
  };
  const service = new DocumentDeliveryService(
    prisma as never,
    pdf as never,
    mail as never,
    whatsapp as never,
  );
  const ctx = { companyIds: ['c1'], ability: { can: () => canSend } } as never;
  return { service, prisma, pdf, whatsapp, ctx };
}

const body = {
  phone: '06 12 34 56 78',
  message: 'Voici votre facture',
  attachPdf: true,
  savePhoneToContact: false,
};

describe('DocumentDeliveryService.sendByWhatsapp', () => {
  it('sends the PDF and marks the document as sent', async () => {
    const { service, prisma, pdf, whatsapp, ctx } = setup();
    await service.sendByWhatsapp(ctx, 'd1', body);

    expect(pdf.renderBytes).toHaveBeenCalledOnce();
    expect(whatsapp.send).toHaveBeenCalledWith(
      '0612345678',
      'Voici votre facture',
      expect.objectContaining({ filename: 'F-1.pdf', mimetype: 'application/pdf' }),
    );
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lifecycle: 'SENT' }) }),
    );
  });

  it('sends text only when the PDF is not attached', async () => {
    const { service, pdf, whatsapp, ctx } = setup();
    await service.sendByWhatsapp(ctx, 'd1', { ...body, attachPdf: false });
    expect(pdf.renderBytes).not.toHaveBeenCalled();
    expect(whatsapp.send).toHaveBeenCalledWith('0612345678', 'Voici votre facture', undefined);
  });

  it('refuses a draft: it has no real number yet', async () => {
    const { service, whatsapp, ctx } = setup('DRAFT');
    await expect(service.sendByWhatsapp(ctx, 'd1', body)).rejects.toMatchObject({
      code: 'NOT_VALIDATED',
    });
    expect(whatsapp.send).not.toHaveBeenCalled();
  });

  it('refuses a role that may not send', async () => {
    const { service, whatsapp, ctx } = setup('VALIDATED', false);
    await expect(service.sendByWhatsapp(ctx, 'd1', body)).rejects.toMatchObject({ status: 403 });
    expect(whatsapp.send).not.toHaveBeenCalled();
  });

  it('rejects a bad number before rendering a PDF', async () => {
    const { service, pdf, ctx } = setup();
    await expect(service.sendByWhatsapp(ctx, 'd1', { ...body, phone: 'abc' })).rejects.toThrow();
    expect(pdf.renderBytes).not.toHaveBeenCalled();
  });

  it('does not mark the document sent when the gateway fails', async () => {
    const { service, prisma, whatsapp, ctx } = setup();
    whatsapp.send.mockRejectedValueOnce(new Error('gateway down'));
    await expect(service.sendByWhatsapp(ctx, 'd1', body)).rejects.toThrow('gateway down');
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('saves the number on the contact only when asked, and only if it had none', async () => {
    const a = setup();
    await a.service.sendByWhatsapp(a.ctx, 'd1', body);
    expect(a.prisma.contact.updateMany).not.toHaveBeenCalled();

    const b = setup();
    await b.service.sendByWhatsapp(b.ctx, 'd1', { ...body, savePhoneToContact: true });
    expect(b.prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: 'k1', phone: null },
      data: { phone: '06 12 34 56 78' },
    });
  });
});
