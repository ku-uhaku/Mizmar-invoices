import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { AuditService } from './audit.service';

@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @TsRestHandler(apiContract.audit.list)
  list(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.audit.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.audit.list(ctx, query),
    }));
  }

  @TsRestHandler(apiContract.audit.documentHistory)
  documentHistory(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.audit.documentHistory, async ({ params, query }) => ({
      status: 200 as const,
      body: await this.audit.list(ctx, {
        ...query,
        entityType: 'Document',
        entityId: params.id,
      }),
    }));
  }
}
