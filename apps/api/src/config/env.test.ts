import { describe, expect, it } from 'vitest';
import { parseCorsOrigins, validateEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  REDIS_URL: 'redis://localhost:6380',
  JWT_ACCESS_SECRET: 'a'.repeat(20),
  JWT_REFRESH_SECRET: 'b'.repeat(20),
  S3_ENDPOINT: 'http://localhost:8333',
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.API_PORT).toBe(3001);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('fails fast and names every problem', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'short', DATABASE_URL: 'nope' })).toThrow(
      /DATABASE_URL[\s\S]*JWT_ACCESS_SECRET|JWT_ACCESS_SECRET[\s\S]*DATABASE_URL/,
    );
  });
});

describe('parseCorsOrigins', () => {
  it('splits and trims', () => {
    expect(parseCorsOrigins('http://a.com, http://b.com ,')).toEqual(['http://a.com', 'http://b.com']);
  });
});
