import { createHash, randomBytes } from 'node:crypto';

/** A reset link is valid for one hour. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
/** At most one live token per user per this window. */
export const RESET_TOKEN_COOLDOWN_MS = 60 * 1000;

export type Identifier = { kind: 'email'; value: string } | { kind: 'username'; value: string };

/** An identifier containing '@' is an email; anything else is a username. */
export function parseIdentifier(raw: string): Identifier {
  const value = raw.trim().toLowerCase();
  return value.includes('@') ? { kind: 'email', value } : { kind: 'username', value };
}

export function identifierWhere(raw: string): { email: string } | { username: string } {
  const id = parseIdentifier(raw);
  return id.kind === 'email' ? { email: id.value } : { username: id.value };
}

/** Raw tokens are 256 random bits, URL-safe; only their SHA-256 is stored. */
export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function resetTokenExpiry(now: number = Date.now()): Date {
  return new Date(now + RESET_TOKEN_TTL_MS);
}

export function isResetTokenUsable(
  row: { expiresAt: Date; usedAt: Date | null },
  now: number = Date.now(),
): boolean {
  return row.usedAt === null && row.expiresAt.getTime() > now;
}

/** True when a token created at `createdAt` is recent enough to block a new one. */
export function withinCooldown(createdAt: Date, now: number = Date.now()): boolean {
  return now - createdAt.getTime() < RESET_TOKEN_COOLDOWN_MS;
}

export function buildResetUrl(webBaseUrl: string, token: string): string {
  return `${webBaseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
}
