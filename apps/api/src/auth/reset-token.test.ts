import { describe, expect, it } from 'vitest';
import {
  RESET_TOKEN_COOLDOWN_MS,
  RESET_TOKEN_TTL_MS,
  buildResetUrl,
  generateResetToken,
  hashResetToken,
  identifierWhere,
  isResetTokenUsable,
  parseIdentifier,
  resetTokenExpiry,
  withinCooldown,
} from './reset-token';

describe('identifier parsing', () => {
  it('treats anything with @ as an email, lowercased and trimmed', () => {
    expect(parseIdentifier('  Owner@Mizmar.MA ')).toEqual({ kind: 'email', value: 'owner@mizmar.ma' });
  });
  it('treats the rest as a username', () => {
    expect(identifierWhere(' Amina.B ')).toEqual({ username: 'amina.b' });
    expect(identifierWhere('a@b.c')).toEqual({ email: 'a@b.c' });
  });
});

describe('reset tokens', () => {
  it('generates unique, long tokens and hashes deterministically', () => {
    const a = generateResetToken();
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(a).not.toBe(generateResetToken());
    expect(hashResetToken(a)).toBe(hashResetToken(a));
    expect(hashResetToken(a)).not.toBe(a);
    expect(hashResetToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('expires after one hour', () => {
    const now = 1_000_000;
    expect(resetTokenExpiry(now).getTime()).toBe(now + RESET_TOKEN_TTL_MS);
    const row = { expiresAt: resetTokenExpiry(now), usedAt: null };
    expect(isResetTokenUsable(row, now + RESET_TOKEN_TTL_MS - 1)).toBe(true);
    expect(isResetTokenUsable(row, now + RESET_TOKEN_TTL_MS)).toBe(false);
  });

  it('rejects used tokens', () => {
    expect(isResetTokenUsable({ expiresAt: new Date(Date.now() + 5000), usedAt: new Date() })).toBe(false);
  });

  it('applies a one-minute cooldown', () => {
    const now = 5_000_000;
    expect(withinCooldown(new Date(now - 1000), now)).toBe(true);
    expect(withinCooldown(new Date(now - RESET_TOKEN_COOLDOWN_MS), now)).toBe(false);
  });

  it('builds the link', () => {
    expect(buildResetUrl('http://x.test/', 'a+b')).toBe('http://x.test/reset-password?token=a%2Bb');
  });
});
