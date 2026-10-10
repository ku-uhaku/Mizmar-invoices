import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { moduleContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { LotsService } from './lots.service';

const c = moduleContract.lots;

@Controller()
export class LotsController {
  constructor(private readonly lots: LotsService) {}

  @TsRestHandler(c.list)
  list(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.list, async ({ query }) => ({ status: 200 as const, body: await this.lots.list(ctx, query) }));
  }

  @TsRestHandler(c.unassigned)
  unassigned(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.unassigned, async () => ({ status: 200 as const, body: await this.lots.unassigned(ctx) }));
  }

  @TsRestHandler(c.tracked)
  tracked(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.tracked, async ({ query }) => ({ status: 200 as const, body: await this.lots.tracked(ctx, query) }));
  }

  @TsRestHandler(c.setTracking)
  setTracking(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.setTracking, async ({ body }) => ({ status: 200 as const, body: await this.lots.setTracking(ctx, body) }));
  }

  @TsRestHandler(c.assign)
  assign(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.assign, async ({ body }) => ({ status: 201 as const, body: await this.lots.assign(ctx, body) }));
  }

  @TsRestHandler(c.update)
  update(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.update, async ({ params, body }) => ({ status: 200 as const, body: await this.lots.update(ctx, params.id, body) }));
  }

  @TsRestHandler(c.writeOff)
  writeOff(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.writeOff, async ({ params, body }) => ({ status: 200 as const, body: await this.lots.writeOff(ctx, params.id, body) }));
  }

  @TsRestHandler(c.trace)
  trace(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.trace, async ({ params }) => ({ status: 200 as const, body: await this.lots.trace(ctx, params.id) }));
  }

  @TsRestHandler(c.generateBarcodes)
  generateBarcodes(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.generateBarcodes, async ({ body }) => ({ status: 200 as const, body: await this.lots.generateBarcodes(ctx, body.variantIds) }));
  }
}
