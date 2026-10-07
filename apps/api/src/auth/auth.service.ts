import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { defineAbilityFor, type Role } from '@mizmar/core';
import type { authSchemas } from '@mizmar/contracts';
import { z } from 'zod';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env';
import { generateRefreshToken, hashPassword, verifyPassword } from './password';
import type { AccessTokenPayload } from './jwt.types';
import type { RequestContext } from '../tenancy/request-context';
import { MailService } from '../mail/mail.service';
import {
  buildResetUrl,
  generateResetToken,
  hashResetToken,
  identifierWhere,
  isResetTokenUsable,
  resetTokenExpiry,
  withinCooldown,
} from './reset-token';

type SessionUser = z.infer<typeof authSchemas.sessionUser>;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginMeta {
  userAgent?: string;
  ipAddress?: string;
}

/** Roles that implicitly reach every company in the organization. */
const ORG_WIDE_ROLES: ReadonlySet<Role> = new Set<Role>(['OWNER', 'ADMIN']);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly mail: MailService,
  ) {}

  // -------------------------------------------------------------------------
  // Login / refresh / logout
  // -------------------------------------------------------------------------

  async login(
    identifier: string,
    password: string,
    meta: LoginMeta,
  ): Promise<TokenPair & { user: SessionUser }> {
    const user = await this.prisma.user.findUnique({
      where: identifierWhere(identifier),
      include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });

    // Verify against a dummy hash when the user does not exist, so a missing
    // account and a wrong password take the same time to answer.
    const stored = user?.passwordHash ?? DUMMY_HASH;
    const passwordOk = await verifyPassword(password, stored);

    if (!user || !passwordOk || !user.isActive) {
      throw AppError.unauthorized('Email/username or password is incorrect');
    }

    const membership = user.memberships[0];
    if (!membership) {
      throw AppError.forbidden('This account does not belong to any organization');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.issueTokens(user.id, user.email, membership.organizationId, membership.id, meta);
    return { ...tokens, user: await this.buildSessionUser(membership.id) };
  }

  async refresh(rawToken: string, meta: LoginMeta): Promise<TokenPair> {
    const tokenHash = hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } } } },
    });

    if (!existing) throw AppError.unauthorized('Invalid refresh token');

    // A token presented after it was already rotated means someone is holding
    // a stolen copy. Burn the whole chain rather than quietly issuing a pair.
    if (existing.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(`Reuse of a rotated refresh token for user ${existing.userId}; chain revoked`);
      throw AppError.unauthorized('Session expired, please sign in again');
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw AppError.unauthorized('Session expired, please sign in again');
    }

    const membership = existing.user.memberships[0];
    if (!existing.user.isActive || !membership) {
      throw AppError.unauthorized('Session is no longer valid');
    }

    const next = await this.issueTokens(
      existing.userId,
      existing.user.email,
      membership.organizationId,
      membership.id,
      meta,
    );

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedById: next.refreshTokenId },
    });

    return { accessToken: next.accessToken, refreshToken: next.refreshToken, expiresIn: next.expiresIn };
  }

  async logout(rawToken: string | undefined, userId: string): Promise<void> {
    if (rawToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(rawToken), userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return;
    }
    // No token supplied: sign the user out everywhere.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw AppError.badRequest('WRONG_PASSWORD', 'Your current password is incorrect');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(newPassword) },
      }),
      // Changing a password ends every other session.
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  // -------------------------------------------------------------------------
  // Password reset
  // -------------------------------------------------------------------------

  /**
   * Email a reset link. Never reveals whether the account exists: unknown,
   * inactive and rate-limited requests all return normally.
   */
  async forgotPassword(identifier: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: identifierWhere(identifier) });
    if (!user || !user.isActive) return;

    const latest = await this.prisma.passwordResetToken.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && withinCooldown(latest.createdAt)) return;

    const token = generateResetToken();
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashResetToken(token), expiresAt: resetTokenExpiry() },
    });

    const url = buildResetUrl(this.config.get('WEB_BASE_URL', { infer: true }), token);
    // Not awaited: SMTP latency must not distinguish existing accounts.
    void this.mail
      .send({
        to: [user.email],
        subject: 'Reset your Mizmar password',
        body: [
          `Hello ${user.fullName},`,
          '',
          'We received a request to reset your Mizmar password. Open this link to choose a new one (valid for 1 hour):',
          '',
          url,
          '',
          'If you did not ask for this, you can ignore this email.',
        ].join('\n'),
      })
      .catch((cause: unknown) => {
        this.logger.error(`Could not send reset email to user ${user.id}: ${String(cause)}`);
      });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(token) },
      include: { user: true },
    });
    if (!row || !row.user.isActive || !isResetTokenUsable(row)) {
      throw AppError.badRequest('INVALID_RESET_TOKEN', 'This reset link is invalid or has expired');
    }

    const passwordHash = await hashPassword(newPassword);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Claim the token atomically so a link cannot be used twice concurrently.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count === 0) {
        throw AppError.badRequest('INVALID_RESET_TOKEN', 'This reset link is invalid or has expired');
      }
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
      await tx.passwordResetToken.updateMany({
        where: { userId: row.userId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  }

  // -------------------------------------------------------------------------
  // Session and request context
  // -------------------------------------------------------------------------

  async buildSessionUser(membershipId: string): Promise<SessionUser> {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      include: {
        user: true,
        organization: true,
        companyAccess: { include: { company: true } },
      },
    });

    if (!membership) throw AppError.unauthorized('Membership no longer exists');

    const companies = await this.resolveCompanies(membership.organizationId, membership.role, membership.companyAccess.map((a) => a.company));
    const ability = defineAbilityFor({
      role: membership.role,
      userId: membership.userId,
      companyIds: companies.map((c) => c.id),
    });

    return {
      id: membership.user.id,
      email: membership.user.email,
      username: membership.user.username,
      fullName: membership.user.fullName,
      locale: membership.user.locale,
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      role: membership.role,
      companies: companies.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        defaultCurrency: c.defaultCurrency,
        defaultLocale: c.defaultLocale,
      })),
      permissions: ability.rules as unknown as Array<Record<string, unknown>>,
    };
  }

  /**
   * Resolve the request context, including which legal entity this call acts in.
   * A requested company the member cannot reach is a 403, never a silent
   * fallback to another company's data.
   */
  async loadContext(
    payload: AccessTokenPayload,
    requestedCompanyId: string | undefined,
  ): Promise<RequestContext> {
    const membership = await this.prisma.membership.findUnique({
      where: { id: payload.membershipId },
      include: {
        user: true,
        organization: true,
        companyAccess: { include: { company: true } },
      },
    });

    if (!membership || membership.userId !== payload.sub) {
      throw AppError.unauthorized('Session is no longer valid');
    }
    if (!membership.user.isActive) {
      throw AppError.unauthorized('This account has been deactivated');
    }

    const companies = await this.resolveCompanies(
      membership.organizationId,
      membership.role,
      membership.companyAccess.map((a) => a.company),
    );
    const companyIds = companies.map((c) => c.id);

    if (companyIds.length === 0) {
      throw AppError.forbidden('You have no access to any company in this organization');
    }

    if (requestedCompanyId && !companyIds.includes(requestedCompanyId)) {
      throw AppError.forbidden('You do not have access to that company');
    }

    return {
      userId: membership.userId,
      email: membership.user.email,
      fullName: membership.user.fullName,
      membershipId: membership.id,
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      role: membership.role,
      companyIds,
      companyId: requestedCompanyId ?? companyIds[0]!,
      ability: defineAbilityFor({
        role: membership.role,
        userId: membership.userId,
        companyIds,
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async resolveCompanies(
    organizationId: string,
    role: Role,
    granted: Array<{ id: string; code: string; name: string; defaultCurrency: string; defaultLocale: 'EN' | 'FR' | 'AR'; isActive: boolean }>,
  ) {
    // Owners and admins reach every company without needing explicit grants,
    // which keeps adding a new legal entity from locking its own admins out.
    if (ORG_WIDE_ROLES.has(role)) {
      return this.prisma.company.findMany({
        where: { organizationId, isActive: true },
        orderBy: { code: 'asc' },
      });
    }
    return granted.filter((c) => c.isActive).sort((a, b) => a.code.localeCompare(b.code));
  }

  private async issueTokens(
    userId: string,
    email: string,
    organizationId: string,
    membershipId: string,
    meta: LoginMeta,
  ): Promise<TokenPair & { refreshTokenId: string }> {
    const payload: AccessTokenPayload = { sub: userId, email, organizationId, membershipId };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    });

    const refreshToken = generateRefreshToken();
    const ttlMs = parseDuration(this.config.get('JWT_REFRESH_TTL', { infer: true }));

    const row = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + ttlMs),
        userAgent: meta.userAgent?.slice(0, 300),
        ipAddress: meta.ipAddress,
      },
      select: { id: true },
    });

    return {
      accessToken,
      refreshToken,
      refreshTokenId: row.id,
      expiresIn: Math.floor(parseDuration(this.config.get('JWT_ACCESS_TTL', { infer: true })) / 1000),
    };
  }
}

/**
 * Refresh tokens are stored as SHA-256 digests. They are long random strings,
 * not passwords, so a fast hash is the right tool: there is nothing to brute
 * force, and we only need the database to be useless to an attacker who reads it.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A hash of a value no password will ever produce, for constant-time login. */
const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const DURATION_RE = /^(\d+)(ms|s|m|h|d)$/;
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(value: string): number {
  const match = DURATION_RE.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: "${value}" (expected e.g. 15m, 30d)`);
  return Number(match[1]) * (UNIT_MS[match[2]!] ?? 0);
}
