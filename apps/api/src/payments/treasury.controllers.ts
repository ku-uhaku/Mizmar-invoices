import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { moduleContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { ChequesService } from './cheques.service';
import { PaymentMethodsService } from './payment-methods.service';

const methods = moduleContract.paymentMethods;
const cheques = moduleContract.cheques;

@Controller()
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

  @TsRestHandler(methods.list)
  list(@Ctx() ctx: RequestContext) {
    return tsRestHandler(methods.list, async () => ({ status: 200 as const, body: await this.service.list(ctx) }));
  }

  @TsRestHandler(methods.create)
  create(@Ctx() ctx: RequestContext) {
    return tsRestHandler(methods.create, async ({ body }) => ({ status: 201 as const, body: await this.service.create(ctx, body) }));
  }

  @TsRestHandler(methods.update)
  update(@Ctx() ctx: RequestContext) {
    return tsRestHandler(methods.update, async ({ params, body }) => ({ status: 200 as const, body: await this.service.update(ctx, params.id, body) }));
  }
}

@Controller()
export class ChequesController {
  constructor(private readonly service: ChequesService) {}

  @TsRestHandler(cheques.list)
  list(@Ctx() ctx: RequestContext) {
    return tsRestHandler(cheques.list, async ({ query }) => ({ status: 200 as const, body: await this.service.list(ctx, query) }));
  }

  @TsRestHandler(cheques.setStatus)
  setStatus(@Ctx() ctx: RequestContext) {
    return tsRestHandler(cheques.setStatus, async ({ params, body }) => ({ status: 200 as const, body: await this.service.setStatus(ctx, params.id, body) }));
  }

  @TsRestHandler(cheques.history)
  history(@Ctx() ctx: RequestContext) {
    return tsRestHandler(cheques.history, async ({ params }) => ({ status: 200 as const, body: await this.service.history(ctx, params.id) }));
  }
}
