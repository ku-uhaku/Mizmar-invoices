import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { InventoryService } from './inventory.service';

@Controller()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @TsRestHandler(apiContract.inventory.listWarehouses)
  listWarehouses(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.inventory.listWarehouses, async () => ({
      status: 200 as const,
      body: await this.inventory.listWarehouses(ctx),
    }));
  }

  @TsRestHandler(apiContract.inventory.createWarehouse)
  createWarehouse(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.inventory.createWarehouse, async ({ body }) => ({
      status: 201 as const,
      body: await this.inventory.createWarehouse(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.inventory.updateWarehouse)
  updateWarehouse(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.inventory.updateWarehouse, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.inventory.updateWarehouse(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.inventory.stock)
  stock(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.inventory.stock, async ({ query }) => ({
      status: 200 as const,
      body: await this.inventory.listStock(ctx, query),
    }));
  }

  @TsRestHandler(apiContract.inventory.availability)
  availability(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.inventory.availability, async ({ body }) => ({
      status: 200 as const,
      body: await this.inventory.availability(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.inventory.movements)
  movements(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.inventory.movements, async ({ query }) => ({
      status: 200 as const,
      body: await this.inventory.listMovements(ctx, query),
    }));
  }

  @TsRestHandler(apiContract.inventory.adjust)
  adjust(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.inventory.adjust, async ({ body }) => ({
      status: 201 as const,
      body: await this.inventory.adjust(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.inventory.transfer)
  transfer(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.inventory.transfer, async ({ body }) => ({
      status: 201 as const,
      body: await this.inventory.transfer(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.inventory.listCountSessions)
  listCountSessions(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.inventory.listCountSessions, async ({ query }) => ({
      status: 200 as const,
      body: await this.inventory.listCountSessions(ctx, query),
    }));
  }

  @TsRestHandler(apiContract.inventory.createCountSession)
  createCountSession(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.inventory.createCountSession, async ({ body }) => ({
      status: 201 as const,
      body: await this.inventory.createCountSession(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.inventory.getCountSession)
  getCountSession(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.inventory.getCountSession, async ({ params }) => ({
      status: 200 as const,
      body: await this.inventory.getCountSession(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.inventory.submitCount)
  submitCount(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.inventory.submitCount, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.inventory.submitCount(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.inventory.postCount)
  postCount(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.inventory.postCount, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.inventory.postCount(ctx, params.id, body.note),
    }));
  }
}
