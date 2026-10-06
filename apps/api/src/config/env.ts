import { z } from 'zod';

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

/**
 * The environment, validated once at boot.
 *
 * Failing fast here is deliberate: a missing JWT secret or database URL should
 * stop the process with a readable message, not surface as a 500 on the first
 * login an hour later.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(16, 'set a real secret, at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'set a real secret, at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_BUCKET_ASSETS: z.string().default('mizmar-assets'),
  S3_BUCKET_DOCUMENTS: z.string().default('mizmar-documents'),
  S3_FORCE_PATH_STYLE: booleanish.default(true),

  // Chromium for PDF rendering. Left unset, the service probes the usual
  // locations; the Playwright base image sets it explicitly.
  CHROMIUM_PATH: z.string().optional(),
  PDF_RENDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: booleanish.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Mizmar <no-reply@mizmar.local>'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

/** Split the comma-separated CORS_ORIGINS value into an allow-list. */
export const parseCorsOrigins = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
