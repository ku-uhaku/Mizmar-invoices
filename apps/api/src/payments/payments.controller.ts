import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @TsRestHandler(apiContract.payments.list)
  list(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.payments.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.payments.list(ctx, query),
    }));
  }

  @TsRestHandler(apiContract.payments.create)
  create(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.payments.create, async ({ body }) => ({
      status: 201 as const,
      body: await this.payments.create(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.payments.get)
  get(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.payments.get, async ({ params }) => ({
      status: 200 as const,
      body: await this.payments.get(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.payments.update)
  update(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.payments.update, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.payments.update(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.payments.remove)
  remove(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.payments.remove, async ({ params }) => {
      await this.payments.remove(ctx, params.id);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }
}
