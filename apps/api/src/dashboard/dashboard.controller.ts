import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { DashboardService } from './dashboard.service';

@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @TsRestHandler(apiContract.dashboard.get)
  get(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.dashboard.get, async ({ query }) => ({
      status: 200 as const,
      body: await this.dashboard.get(ctx, query),
    }));
  }
}
