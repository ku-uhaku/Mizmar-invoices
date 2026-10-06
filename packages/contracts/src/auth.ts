import { z } from 'zod';
import { localeEnum, roleEnum, uuid } from './common';

export const loginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
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
