import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../config/env';

export interface Attachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendMailInput {
  to: string[];
  cc?: string[];
  subject: string;
  /** Plain text; a minimal HTML version is derived from it. */
  body: string;
  attachments?: Attachment[];
  replyTo?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(input: SendMailInput): Promise<void> {
    const transporter = this.ensureTransporter();

    await transporter.sendMail({
      from: this.config.get('MAIL_FROM', { infer: true }),
      to: input.to.join(', '),
      cc: input.cc?.length ? input.cc.join(', ') : undefined,
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.body,
      html: toSimpleHtml(input.body),
      attachments: input.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
      })),
    });

    this.logger.log(`Sent "${input.subject}" to ${input.to.join(', ')}`);
  }

  private ensureTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const user = this.config.get('SMTP_USER', { infer: true });
    const password = this.config.get('SMTP_PASSWORD', { infer: true });

    this.transporter = createTransport({
      host: this.config.get('SMTP_HOST', { infer: true }),
      port: this.config.get('SMTP_PORT', { infer: true }),
      secure: this.config.get('SMTP_SECURE', { infer: true }),
      // Mailpit in development accepts unauthenticated mail; credentials are
      // only attached when they are actually configured.
      auth: user ? { user, pass: password } : undefined,
    });

    return this.transporter;
  }
}

/**
 * Wrap a plain-text body in minimal HTML.
 * Deliberately not a template: the user wrote this message and should see it
 * delivered as written, not restyled.
 */
function toSimpleHtml(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111827">${escaped}</div>`;
}
