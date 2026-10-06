import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * scrypt from Node's core crypto, rather than a native argon2 binding.
 *
 * scrypt is memory-hard and a perfectly respectable password KDF; using the
 * built-in removes a compiled dependency from every install and CI run. The
 * stored format carries its own parameters, so these can be raised later and
 * old hashes keep verifying.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 96 * 1024 * 1024 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, PARAMS.keylen, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const expected = Buffer.from(hashB64 ?? '', 'base64');
  const salt = Buffer.from(saltB64 ?? '', 'base64');
  if (expected.length === 0 || salt.length === 0) return false;

  try {
    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: PARAMS.maxmem,
    });
    // Constant-time: a length-dependent early return would leak hash length.
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Opaque refresh token; only its hash is stored, so a DB leak is not a session leak. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}
