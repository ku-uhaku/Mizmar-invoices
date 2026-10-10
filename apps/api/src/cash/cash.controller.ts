import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { moduleContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { CashService } from './cash.service';

const c = moduleContract.cash;

@Controller()
export class CashController {
  constructor(private readonly cash: CashService) {}

  @TsRestHandler(c.listRegisters)
  listRegisters(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.listRegisters, async () => ({ status: 200 as const, body: await this.cash.listRegisters(ctx) }));
  }

  @TsRestHandler(c.createRegister)
  createRegister(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.createRegister, async ({ body }) => ({ status: 201 as const, body: await this.cash.createRegister(ctx, body) }));
  }

  @TsRestHandler(c.updateRegister)
  updateRegister(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.updateRegister, async ({ params, body }) => ({ status: 200 as const, body: await this.cash.updateRegister(ctx, params.id, body) }));
  }

  @TsRestHandler(c.listSessions)
  listSessions(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.listSessions, async ({ query }) => ({ status: 200 as const, body: await this.cash.list(ctx, query) }));
  }

  @TsRestHandler(c.openSession)
  openSession(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.openSession, async ({ body }) => ({ status: 201 as const, body: await this.cash.open(ctx, body) }));
  }

  @TsRestHandler(c.getSession)
  getSession(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.getSession, async ({ params }) => ({ status: 200 as const, body: await this.cash.get(ctx, params.id) }));
  }

  @TsRestHandler(c.addMovement)
  addMovement(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.addMovement, async ({ params, body }) => ({ status: 201 as const, body: await this.cash.addMovement(ctx, params.id, body) }));
  }

  @TsRestHandler(c.closeSession)
  closeSession(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.closeSession, async ({ params, body }) => ({ status: 200 as const, body: await this.cash.close(ctx, params.id, body) }));
  }
}
