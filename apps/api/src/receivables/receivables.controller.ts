import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { ReceivablesService } from './receivables.service';

@Controller()
export class ReceivablesController {
  constructor(private readonly receivables: ReceivablesService) {}

  @TsRestHandler(apiContract.receivables.overdue)
  overdue(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.receivables.overdue, async ({ query }) => ({
      status: 200 as const,
      body: await this.receivables.overdue(ctx, query),
    }));
  }

  @TsRestHandler(apiContract.receivables.ageing)
  ageing(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.receivables.ageing, async () => ({
      status: 200 as const,
      body: await this.receivables.ageing(ctx),
    }));
  }

  @TsRestHandler(apiContract.receivables.remind)
  remind(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.receivables.remind, async ({ body }) => ({
      status: 200 as const,
      body: await this.receivables.remind(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.receivables.reminders)
  reminders(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.receivables.reminders, async ({ params }) => ({
      status: 200 as const,
      body: await this.receivables.history(ctx, params.id),
    }));
  }
}
