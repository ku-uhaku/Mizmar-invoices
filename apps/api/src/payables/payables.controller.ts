import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { moduleContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { PayablesService } from './payables.service';

const c = moduleContract.payables;

@Controller()
export class PayablesController {
  constructor(private readonly payables: PayablesService) {}

  @TsRestHandler(c.overview)
  overview(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.overview, async ({ query }) => ({
      status: 200 as const,
      body: await this.payables.overview(ctx, query),
    }));
  }
}
