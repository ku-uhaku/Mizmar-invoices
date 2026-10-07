import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { ImportsService } from './imports.service';

@Controller()
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @TsRestHandler(apiContract.imports.preview)
  preview(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.imports.preview, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.imports.preview(ctx, params.kind, body),
    }));
  }

  @TsRestHandler(apiContract.imports.commit)
  commit(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.imports.commit, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.imports.commit(ctx, params.kind, body),
    }));
  }

  @TsRestHandler(apiContract.imports.template)
  template(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.imports.template, async ({ params, query }) => ({
      status: 200 as const,
      body: this.imports.template(ctx, params.kind, query.lang),
    }));
  }
}
