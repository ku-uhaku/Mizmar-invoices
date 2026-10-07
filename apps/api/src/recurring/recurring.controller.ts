import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { RecurringService } from './recurring.service';

@Controller()
export class RecurringController {
  constructor(private readonly recurring: RecurringService) {}

  @TsRestHandler(apiContract.recurring.list)
  list(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.recurring.list, async () => ({
      status: 200 as const,
      body: await this.recurring.list(ctx),
    }));
  }

  @TsRestHandler(apiContract.recurring.create)
  create(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.recurring.create, async ({ body }) => ({
      status: 201 as const,
      body: await this.recurring.create(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.recurring.fromDocument)
  fromDocument(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.recurring.fromDocument, async ({ params, body }) => ({
      status: 201 as const,
      body: await this.recurring.fromDocument(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.recurring.get)
  get(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.recurring.get, async ({ params }) => ({
      status: 200 as const,
      body: await this.recurring.get(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.recurring.update)
  update(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.recurring.update, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.recurring.update(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.recurring.remove)
  remove(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.recurring.remove, async ({ params }) => {
      await this.recurring.remove(ctx, params.id);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @TsRestHandler(apiContract.recurring.pause)
  pause(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.recurring.pause, async ({ params }) => ({
      status: 200 as const,
      body: await this.recurring.pause(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.recurring.resume)
  resume(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.recurring.resume, async ({ params }) => ({
      status: 200 as const,
      body: await this.recurring.resume(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.recurring.runNow)
  runNow(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.recurring.runNow, async ({ params }) => ({
      status: 200 as const,
      body: await this.recurring.runNow(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.recurring.runs)
  runs(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.recurring.runs, async ({ params }) => ({
      status: 200 as const,
      body: await this.recurring.runs(ctx, params.id),
    }));
  }
}
