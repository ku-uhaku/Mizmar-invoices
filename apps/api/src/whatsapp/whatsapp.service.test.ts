import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsappService } from './whatsapp.service';

function service(env: Record<string, string | undefined>) {
  const config = { get: (key: string) => env[key] };
  return new WhatsappService(config as never);
}

const CONFIGURED = {
  OPENWA_URL: 'http://wa.local:2785/',
  OPENWA_API_KEY: 'secret',
  OPENWA_SESSION_ID: 'sess-1',
};

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({}),
    text: async () => '',
    ...response,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('WhatsappService', () => {
  it('is off until all three settings are present', () => {
    expect(service({}).isConfigured()).toBe(false);
    expect(service({ ...CONFIGURED, OPENWA_API_KEY: undefined }).isConfigured()).toBe(false);
    expect(service(CONFIGURED).isConfigured()).toBe(true);
  });

  it('reports unconfigured status without calling the gateway', async () => {
    const fetchMock = stubFetch({});
    expect(await service({}).status()).toEqual({ configured: false, status: null, phone: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to send when not configured', async () => {
    await expect(service({}).sendText('0612345678', 'hi')).rejects.toMatchObject({
      code: 'WHATSAPP_NOT_CONFIGURED',
    });
  });

  it('sends text to the normalised chat id with the API key', async () => {
    const fetchMock = stubFetch({});
    await service(CONFIGURED).sendText('06 12 34 56 78', 'Bonjour');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://wa.local:2785/api/sessions/sess-1/messages/send-text');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('secret');
    expect(JSON.parse(init.body as string)).toEqual({
      chatId: '212612345678@c.us',
      text: 'Bonjour',
    });
  });

  it('sends a PDF as base64 with a capped caption', async () => {
    const fetchMock = stubFetch({});
    await service(CONFIGURED).sendDocument('212612345678', {
      bytes: Buffer.from('%PDF'),
      filename: 'F-1.pdf',
      mimetype: 'application/pdf',
      caption: 'x'.repeat(2000),
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.base64).toBe(Buffer.from('%PDF').toString('base64'));
    expect(body.mimetype).toBe('application/pdf');
    expect(body.filename).toBe('F-1.pdf');
    expect(body.caption).toHaveLength(1024);
  });

  it('rejects an invalid number before calling the gateway', async () => {
    const fetchMock = stubFetch({});
    await expect(service(CONFIGURED).sendText('abc', 'hi')).rejects.toMatchObject({
      code: 'INVALID_PHONE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a gateway refusal and an unreachable gateway to distinct errors', async () => {
    stubFetch({ ok: false, status: 401 });
    await expect(service(CONFIGURED).sendText('212612345678', 'hi')).rejects.toMatchObject({
      code: 'WHATSAPP_SEND_FAILED',
    });

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))));
    await expect(service(CONFIGURED).sendText('212612345678', 'hi')).rejects.toMatchObject({
      code: 'WHATSAPP_UNREACHABLE',
    });
  });

  it('reports "unreachable" status instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('down'))));
    expect(await service(CONFIGURED).status()).toMatchObject({
      configured: true,
      status: 'unreachable',
    });
  });

  it('send() picks a document when there is a file, text otherwise', async () => {
    const fetchMock = stubFetch({});
    const wa = service(CONFIGURED);
    await wa.send('212612345678', 'hello');
    await wa.send('212612345678', 'hello', {
      bytes: Buffer.from('x'),
      filename: 'a.pdf',
      mimetype: 'application/pdf',
    });
    const urls = fetchMock.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls[0]).toMatch(/send-text$/);
    expect(urls[1]).toMatch(/send-document$/);
  });
});
