import { describe, expect, it } from 'vitest';
import { generateRefreshToken, hashPassword, verifyPassword } from './password';
import { parseDuration } from './auth.service';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('Mizmar2026!');
    expect(await verifyPassword('Mizmar2026!', stored)).toBe(true);
    expect(await verifyPassword('mizmar2026!', stored)).toBe(false);
  });

  it('salts: the same password never hashes the same way twice', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('treats Unicode-equivalent passwords as equal', async () => {
    const stored = await hashPassword('café-secret');
    expect(await verifyPassword('café-secret', stored)).toBe(true);
  });

  it('rejects malformed stored values instead of throwing', async () => {
    for (const bad of ['', 'plain', 'scrypt$1$2', 'bcrypt$a$b$c$d$e']) {
      expect(await verifyPassword('x', bad)).toBe(false);
    }
  });

  it('issues long, unique refresh tokens', () => {
    const a = generateRefreshToken();
    expect(a.length).toBeGreaterThan(40);
    expect(a).not.toBe(generateRefreshToken());
  });
});

describe('parseDuration', () => {
  it('parses each unit', () => {
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('30d')).toBe(2_592_000_000);
  });

  it('refuses nonsense rather than returning NaN', () => {
    expect(() => parseDuration('soon')).toThrow(/Invalid duration/);
  });
});
