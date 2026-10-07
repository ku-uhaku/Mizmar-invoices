import { z } from 'zod';
import { localeEnum, roleEnum, uuid } from './common';

/** Lowercase handle usable at login in place of the email. */
export const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9._-]+$/, 'Use only letters, digits, dots, dashes and underscores');

export const loginRequest = z
  .object({
    /** Email or username. */
    identifier: z.string().trim().min(1).max(320).optional(),
    /** Legacy field, still accepted: same meaning as `identifier`. */
    email: z.string().trim().min(1).max(320).optional(),
    password: z.string().min(8),
  })
  .refine((v) => Boolean(v.identifier ?? v.email), {
    message: 'identifier is required',
    path: ['identifier'],
  });

export const forgotPasswordRequest = z.object({
  identifier: z.string().trim().min(1).max(320),
});

export const resetPasswordRequest = z.object({
  token: z.string().min(20).max(200),
  newPassword: z.string().min(8).max(200),
});

export const refreshRequest = z.object({
  refreshToken: z.string().min(20),
});

export const companySummary = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  defaultCurrency: z.string(),
  defaultLocale: localeEnum,
});

export const sessionUser = z.object({
  id: uuid,
  email: z.string().email(),
  username: z.string().nullable(),
  fullName: z.string(),
  locale: localeEnum,
  organizationId: uuid,
  organizationName: z.string(),
  role: roleEnum,
  /** The legal entities this member may act in; drives the company switcher. */
  companies: z.array(companySummary),
  /** Serialised CASL rules, so the UI hides exactly what the API refuses. */
  permissions: z.array(z.record(z.unknown())),
});

export const authTokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
});

export const loginResponse = authTokens.extend({ user: sessionUser });

export const changePasswordRequest = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8).max(200),
});

export type LoginRequest = z.infer<typeof loginRequest>;
export type SessionUser = z.infer<typeof sessionUser>;
export type AuthTokens = z.infer<typeof authTokens>;
