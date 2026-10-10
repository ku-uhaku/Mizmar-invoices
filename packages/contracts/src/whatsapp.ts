import { z } from 'zod';

export const whatsappStatus = z.object({
  /** False when the server has no OpenWA gateway configured. */
  configured: z.boolean(),
  /** OpenWA session status: ready, qr_ready, disconnected, unreachable, ... */
  status: z.string().nullable(),
  phone: z.string().nullable(),
});

export const whatsappQr = z.object({
  /** PNG data URL to scan from WhatsApp > Linked devices; null when none is pending. */
  qrCode: z.string().nullable(),
});

export type WhatsappStatus = z.infer<typeof whatsappStatus>;
