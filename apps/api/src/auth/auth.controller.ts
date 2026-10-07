import { Controller, Req } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract } from '@mizmar/contracts';
import type { FastifyRequest } from 'fastify';
import { Ctx } from '../common/decorators/ctx.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @TsRestHandler(apiContract.auth.login)
  login(@Req() request: FastifyRequest) {
    return tsRestHandler(apiContract.auth.login, async ({ body }) => {
      const result = await this.auth.login((body.identifier ?? body.email)!, body.password, metaOf(request));
      return { status: 200 as const, body: result };
    });
  }

  @Public()
  @TsRestHandler(apiContract.auth.refresh)
  refresh(@Req() request: FastifyRequest) {
    return tsRestHandler(apiContract.auth.refresh, async ({ body }) => {
      const tokens = await this.auth.refresh(body.refreshToken, metaOf(request));
      return { status: 200 as const, body: tokens };
    });
  }

  @TsRestHandler(apiContract.auth.logout)
  logout(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.auth.logout, async ({ body }) => {
      await this.auth.logout(body.refreshToken, ctx.userId);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @Public()
  @TsRestHandler(apiContract.auth.forgotPassword)
  forgotPassword() {
    return tsRestHandler(apiContract.auth.forgotPassword, async ({ body }) => {
      await this.auth.forgotPassword(body.identifier);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @Public()
  @TsRestHandler(apiContract.auth.resetPassword)
  resetPassword() {
    return tsRestHandler(apiContract.auth.resetPassword, async ({ body }) => {
      await this.auth.resetPassword(body.token, body.newPassword);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @TsRestHandler(apiContract.auth.me)
  me(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.auth.me, async () => ({
      status: 200 as const,
      body: await this.auth.buildSessionUser(ctx.membershipId),
    }));
  }

  @TsRestHandler(apiContract.auth.changePassword)
  changePassword(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.auth.changePassword, async ({ body }) => {
      await this.auth.changePassword(ctx.userId, body.currentPassword, body.newPassword);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }
}

function metaOf(request: FastifyRequest): { userAgent?: string; ipAddress?: string } {
  return {
    userAgent: request.headers['user-agent'],
    ipAddress: request.ip,
  };
}
