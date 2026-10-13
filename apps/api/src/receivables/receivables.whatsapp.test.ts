import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ReceivablesService } from './receivables.service';

const K1 = '00000000-0000-4000-8000-000000000001';
const D1 = '00000000-0000-4000-8000-0000000000d1';

function invoice(contact: { email: string | null; phone: string | null }, extra = {}) {
  return {
    id: D1,
    number: 'F-1',
    contactId: K1,
    issueDate: new Date('2020-01-01'),
    dueDate: new Date('2020-02-01'),
    currency: 'MAD',
    locale: 'FR',
    totalInclVat: new Prisma.Decimal('120'),
    paidAmount: new Prisma.Decimal('20'),
    contact: { id: K1, displayName: 'ACME', defaultLocale: null, ...contact },
    reminders: [],
    ...extra,
  };
}

function setup(row: ReturnType<typeof invoice>, whatsappConfigured = true) {
  const prisma = {
    document: { findMany: vi.fn(async () => [row]) },
    company: {
      findUniqueOrThrow: vi.fn(async () => ({ name: 'Mizmar', defaultLocale: 'FR' })),
    },
    paymentReminder: { createMany: vi.fn(async () => ({ count: 1 })) },
    contact: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const mail = { send: vi.fn(async () => undefined) };
  const pdf = {
    renderBytes: vi.fn(async () => ({ bytes: Buffer.from('%PDF'), fileName: 'F-1.pdf' })),
  };
  const whatsapp = {
    isConfigured: vi.fn(() => whatsappConfigured),
    sendText: vi.fn(async () => undefined),
    sendDocument: vi.fn(async () => undefined),
  };
  const service = new ReceivablesService(
    prisma as never,
    mail as never,
    pdf as never,
    whatsapp as never,
  );
  const ctx = {
    companyId: 'c1',
    userId: 'u1',
    email: 'me@x.y',
    ability: { can: () => true },
  } as never;
  return { service, prisma, mail, whatsapp, ctx };
}

const base = { documentIds: [D1], force: false, attachPdf: true, channels: ['EMAIL'] as const };
const loggedChannels = (prisma: ReturnType<typeof setup>['prisma']) =>
  (prisma.paymentReminder.createMany.mock.calls as unknown as Array<[{ data: Array<{ channel: string }> }]>)[0]![0].data.map(
    (d) => d.channel,
  );

describe('ReceivablesService.remind channels', () => {
  it('email only: unchanged behaviour, nothing sent on WhatsApp', async () => {
    const { service, mail, whatsapp, prisma, ctx } = setup(
      invoice({ email: 'a@b.c', phone: '0612345678' }),
    );
    const result = await service.remind(ctx, { ...base, channels: ['EMAIL'] });
    expect(result.sent).toBe(1);
    expect(mail.send).toHaveBeenCalledOnce();
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(loggedChannels(prisma)).toEqual(['EMAIL']);
  });

  it('both channels: sends the text and the PDF on WhatsApp and logs both', async () => {
    const { service, mail, whatsapp, prisma, ctx } = setup(
      invoice({ email: 'a@b.c', phone: '0612345678' }),
    );
    const result = await service.remind(ctx, { ...base, channels: ['EMAIL', 'WHATSAPP'] });
    expect(result.results[0]).toMatchObject({ outcome: 'SENT', contactId: K1 });
    expect(mail.send).toHaveBeenCalledOnce();
    expect(whatsapp.sendText).toHaveBeenCalledWith('0612345678', expect.any(String));
    expect(whatsapp.sendDocument).toHaveBeenCalledOnce();
    expect(loggedChannels(prisma).sort()).toEqual(['EMAIL', 'WHATSAPP']);
  });

  it('uses a typed number for a contact without one and saves it', async () => {
    const { service, whatsapp, prisma, ctx } = setup(invoice({ email: null, phone: null }));
    const result = await service.remind(ctx, {
      ...base,
      channels: ['WHATSAPP'],
      phones: { [K1]: ' 06 12 34 56 78 ' },
    });
    expect(result.sent).toBe(1);
    expect(whatsapp.sendText).toHaveBeenCalledWith('06 12 34 56 78', expect.any(String));
    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: K1, phone: null },
      data: { phone: '06 12 34 56 78' },
    });
  });

  it('prefers the saved number over a typed one and does not overwrite it', async () => {
    const { service, whatsapp, prisma, ctx } = setup(invoice({ email: null, phone: '0611111111' }));
    await service.remind(ctx, { ...base, channels: ['WHATSAPP'], phones: { [K1]: '0622222222' } });
    expect(whatsapp.sendText).toHaveBeenCalledWith('0611111111', expect.any(String));
    expect(prisma.contact.updateMany).not.toHaveBeenCalled();
  });

  it('WhatsApp only with no number: NO_PHONE, nothing sent or logged', async () => {
    const { service, whatsapp, prisma, ctx } = setup(invoice({ email: 'a@b.c', phone: null }));
    const result = await service.remind(ctx, { ...base, channels: ['WHATSAPP'] });
    expect(result.results[0]).toMatchObject({ outcome: 'NO_PHONE', contactId: K1 });
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(prisma.paymentReminder.createMany).not.toHaveBeenCalled();
  });

  it('both channels, no email and no phone: reported, not sent', async () => {
    const { service, ctx } = setup(invoice({ email: null, phone: null }));
    const result = await service.remind(ctx, { ...base, channels: ['EMAIL', 'WHATSAPP'] });
    expect(result.sent).toBe(0);
    expect(result.results[0]!.outcome).toBe('NO_EMAIL');
  });

  it('email succeeds while WhatsApp fails: still SENT, only email logged', async () => {
    const { service, whatsapp, prisma, ctx } = setup(
      invoice({ email: 'a@b.c', phone: '0612345678' }),
    );
    whatsapp.sendText.mockRejectedValueOnce(new Error('gateway down'));
    const result = await service.remind(ctx, { ...base, channels: ['EMAIL', 'WHATSAPP'] });
    expect(result.results[0]).toMatchObject({ outcome: 'SENT', message: 'gateway down' });
    expect(loggedChannels(prisma)).toEqual(['EMAIL']);
  });

  it('every channel fails: FAILED and nothing is logged', async () => {
    const { service, whatsapp, prisma, ctx } = setup(invoice({ email: null, phone: '0612345678' }));
    whatsapp.sendText.mockRejectedValueOnce(new Error('gateway down'));
    const result = await service.remind(ctx, { ...base, channels: ['WHATSAPP'] });
    expect(result.results[0]).toMatchObject({ outcome: 'FAILED', message: 'gateway down' });
    expect(prisma.paymentReminder.createMany).not.toHaveBeenCalled();
  });

  it('asking for WhatsApp while it is not configured fails fast', async () => {
    const { service, mail, ctx } = setup(invoice({ email: 'a@b.c', phone: '0612345678' }), false);
    await expect(
      service.remind(ctx, { ...base, channels: ['EMAIL', 'WHATSAPP'] }),
    ).rejects.toMatchObject({ code: 'WHATSAPP_NOT_CONFIGURED' });
    expect(mail.send).not.toHaveBeenCalled();
  });
});
