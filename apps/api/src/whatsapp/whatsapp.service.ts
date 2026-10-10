import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { AppError } from '../common/app-error';
import { normalizePhone, toChatId } from './phone';

export interface WhatsappStatus {
  configured: boolean;
  /** OpenWA session status: ready, qr_ready, disconnected, ... */
  status: string | null;
  phone: string | null;
}

export interface WhatsappDocument {
  bytes: Buffer;
  filename: string;
  mimetype: string;
  caption?: string;
}

const TIMEOUT_MS = 30_000;

/**
 * Thin client for an OpenWA gateway (https://github.com/rmyndharis/OpenWA).
 *
 * The gateway owns the WhatsApp session; this only talks to its REST API.
 * Everything is a no-op error until OPENWA_* is configured, so email-only
 * installs are unaffected.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  isConfigured(): boolean {
    return Boolean(this.url && this.key && this.session);
  }

  async status(): Promise<WhatsappStatus> {
    if (!this.isConfigured()) return { configured: false, status: null, phone: null };
    try {
      const body = await this.call<{ status?: string; phone?: string | null }>(
        'GET',
        `/sessions/${this.session}`,
      );
      return { configured: true, status: body.status ?? null, phone: body.phone ?? null };
    } catch (error) {
      this.logger.warn(`OpenWA status failed: ${String(error)}`);
      return { configured: true, status: 'unreachable', phone: null };
    }
  }

  /** QR code (data URL) to link the phone; null when the session needs none. */
  async qr(): Promise<string | null> {
    this.assertConfigured();
    try {
      const body = await this.call<{ qrCode?: string | null }>(
        'GET',
        `/sessions/${this.session}/qr`,
      );
      return body.qrCode ?? null;
    } catch {
      return null;
    }
  }

  /** Normalise or fail with a message the user can act on. */
  parsePhone(raw: string): string {
    const phone = normalizePhone(raw);
    if (!phone) {
      throw AppError.badRequest('INVALID_PHONE', `"${raw}" is not a valid phone number`);
    }
    return phone;
  }

  async sendText(rawPhone: string, text: string): Promise<void> {
    this.assertConfigured();
    await this.call('POST', `/sessions/${this.session}/messages/send-text`, {
      chatId: toChatId(this.parsePhone(rawPhone)),
      text,
    });
  }

  async sendDocument(rawPhone: string, file: WhatsappDocument): Promise<void> {
    this.assertConfigured();
    await this.call('POST', `/sessions/${this.session}/messages/send-document`, {
      chatId: toChatId(this.parsePhone(rawPhone)),
      base64: file.bytes.toString('base64'),
      mimetype: file.mimetype,
      filename: file.filename,
      caption: file.caption?.slice(0, 1024),
    });
  }

  /** A caption-carrying document when there is a file, plain text otherwise. */
  async send(
    rawPhone: string,
    message: string,
    file?: { bytes: Buffer; filename: string; mimetype: string },
  ): Promise<void> {
    if (file) {
      await this.sendDocument(rawPhone, { ...file, caption: message });
    } else {
      await this.sendText(rawPhone, message);
    }
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw AppError.conflict('WHATSAPP_NOT_CONFIGURED', 'WhatsApp is not configured on this server');
    }
  }

  private get url() {
    return this.config.get('OPENWA_URL', { infer: true })?.replace(/\/+$/, '');
  }
  private get key() {
    return this.config.get('OPENWA_API_KEY', { infer: true });
  }
  private get session() {
    return this.config.get('OPENWA_SESSION_ID', { infer: true });
  }

  private async call<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.url}/api${path}`, {
        method,
        headers: {
          'X-API-Key': this.key!,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`OpenWA ${method} ${path} unreachable: ${String(error)}`);
      throw new AppError('WHATSAPP_UNREACHABLE', 'The WhatsApp gateway is not reachable', 502);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.warn(`OpenWA ${method} ${path} -> ${response.status} ${detail.slice(0, 300)}`);
      throw new AppError(
        'WHATSAPP_SEND_FAILED',
        `WhatsApp gateway refused the request (${response.status})`,
        502,
      );
    }
    return (await response.json().catch(() => ({}))) as T;
  }
}
