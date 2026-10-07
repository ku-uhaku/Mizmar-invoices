import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { PriceListsService } from './price-lists.service';

const api = apiContract.pricing;

@Controller()
export class PricingController {
  constructor(private readonly svc: PriceListsService) {}

  @TsRestHandler(api.listPriceLists)
  listPriceLists(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.listPriceLists, async () => ({
      status: 200 as const,
      body: await this.svc.list(ctx),
    }));
  }

  @TsRestHandler(api.createPriceList)
  createPriceList(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.createPriceList, async ({ body }) => ({
      status: 201 as const,
      body: await this.svc.create(ctx, body),
    }));
  }

  @TsRestHandler(api.getPriceList)
  getPriceList(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.getPriceList, async ({ params }) => ({
      status: 200 as const,
      body: await this.svc.get(ctx, params.id),
    }));
  }

  @TsRestHandler(api.updatePriceList)
  updatePriceList(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.updatePriceList, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.svc.update(ctx, params.id, body),
    }));
  }

  @TsRestHandler(api.removePriceList)
  removePriceList(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.removePriceList, async ({ params }) => {
      await this.svc.remove(ctx, params.id);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @TsRestHandler(api.upsertPriceListItem)
  upsertPriceListItem(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.upsertPriceListItem, async ({ params, body }) => ({
      status: 201 as const,
      body: await this.svc.upsertItem(ctx, params.id, body),
    }));
  }

  @TsRestHandler(api.updatePriceListItem)
  updatePriceListItem(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.updatePriceListItem, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.svc.updateItem(ctx, params.id, body),
    }));
  }

  @TsRestHandler(api.removePriceListItem)
  removePriceListItem(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.removePriceListItem, async ({ params }) => {
      await this.svc.removeItem(ctx, params.id);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @TsRestHandler(api.assignContacts)
  assignContacts(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.assignContacts, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.svc.assignContacts(ctx, params.id, body),
    }));
  }

  @TsRestHandler(api.getDefaultPriceList)
  getDefaultPriceList(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.getDefaultPriceList, async () => ({
      status: 200 as const,
      body: await this.svc.getDefault(ctx),
    }));
  }

  @TsRestHandler(api.setDefaultPriceList)
  setDefaultPriceList(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.setDefaultPriceList, async ({ body }) => ({
      status: 200 as const,
      body: await this.svc.setDefault(ctx, body.priceListId),
    }));
  }

  @TsRestHandler(api.listExchangeRates)
  listExchangeRates(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.listExchangeRates, async ({ query }) => ({
      status: 200 as const,
      body: await this.svc.listRates(ctx, query),
    }));
  }

  @TsRestHandler(api.createExchangeRate)
  createExchangeRate(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.createExchangeRate, async ({ body }) => ({
      status: 201 as const,
      body: await this.svc.createRate(ctx, body),
    }));
  }

  @TsRestHandler(api.lookupExchangeRate)
  lookupExchangeRate(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.lookupExchangeRate, async ({ query }) => ({
      status: 200 as const,
      body: await this.svc.lookupRate(ctx, query),
    }));
  }

  @TsRestHandler(api.updateExchangeRate)
  updateExchangeRate(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.updateExchangeRate, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.svc.updateRate(ctx, params.id, body),
    }));
  }

  @TsRestHandler(api.removeExchangeRate)
  removeExchangeRate(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.removeExchangeRate, async ({ params }) => {
      await this.svc.removeRate(ctx, params.id);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @TsRestHandler(api.resolve)
  resolve(@Ctx() ctx: RequestContext) {
    return tsRestHandler(api.resolve, async ({ query }) => ({
      status: 200 as const,
      body: await this.svc.resolve(ctx, query),
    }));
  }
}
