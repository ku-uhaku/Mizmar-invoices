import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../common/app-error';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import type { Env } from '../config/env';
import type { RequestWithContext } from '../tenancy/request-context';
import { AuthService } from './auth.service';
import type { AccessTokenPayload } from './jwt.types';

/**
 * Authenticates the bearer token and builds the request context, including
 * resolving the active company from `x-company-id`.
 *
 * Doing both here means no handler can read data without a company scope, and
 * the scope is validated against the member's grants rather than trusted from
 * the header.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly auth: AuthService,
  ) {}

  async canActivate(host: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      host.getHandler(),
      host.getClass(),
    ]);
    if (isPublic) return true;

    const request = host.switchToHttp().getRequest<FastifyRequest & RequestWithContext>();
    const token = extractBearer(request.headers.authorization);
    if (!token) throw AppError.unauthorized();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
    } catch {
      throw AppError.unauthorized('Your session has expired');
    }

    const header = request.headers['x-company-id'];
    const requestedCompanyId = Array.isArray(header) ? header[0] : header;

    request.ctx = await this.auth.loadContext(payload, requestedCompanyId || undefined);
    return true;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}
