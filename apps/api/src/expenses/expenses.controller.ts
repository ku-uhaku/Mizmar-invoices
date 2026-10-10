import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { ExpensesService } from './expenses.service';

const ok = { ok: true as const };

@Controller()
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @TsRestHandler(apiContract.expenses.listCategories)
  listCategories(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.listCategories, async () => ({
      status: 200 as const,
      body: await this.expenses.listCategories(ctx),
    }));
  }

  @TsRestHandler(apiContract.expenses.createCategory)
  createCategory(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.createCategory, async ({ body }) => ({
      status: 201 as const,
      body: await this.expenses.createCategory(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.expenses.updateCategory)
  updateCategory(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.updateCategory, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.expenses.updateCategory(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.expenses.summary)
  summary(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.summary, async () => ({
      status: 200 as const,
      body: await this.expenses.summary(ctx),
    }));
  }

  @TsRestHandler(apiContract.expenses.listRecurring)
  listRecurring(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.listRecurring, async () => ({
      status: 200 as const,
      body: await this.expenses.listRecurring(ctx),
    }));
  }

  @TsRestHandler(apiContract.expenses.generateRecurring)
  generateRecurring(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.generateRecurring, async () => ({
      status: 200 as const,
      body: { generated: await this.expenses.generateForCompany(ctx) },
    }));
  }

  @TsRestHandler(apiContract.expenses.createRecurring)
  createRecurring(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.createRecurring, async ({ body }) => ({
      status: 201 as const,
      body: await this.expenses.createRecurring(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.expenses.updateRecurring)
  updateRecurring(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.updateRecurring, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.expenses.updateRecurring(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.expenses.removeRecurring)
  removeRecurring(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.removeRecurring, async ({ params }) => {
      await this.expenses.removeRecurring(ctx, params.id);
      return { status: 200 as const, body: ok };
    });
  }

  @TsRestHandler(apiContract.expenses.list)
  list(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.expenses.list(ctx, query),
    }));
  }

  @TsRestHandler(apiContract.expenses.create)
  create(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.create, async ({ body }) => ({
      status: 201 as const,
      body: await this.expenses.create(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.expenses.get)
  get(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.get, async ({ params }) => ({
      status: 200 as const,
      body: await this.expenses.get(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.expenses.update)
  update(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.update, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.expenses.update(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.expenses.cancel)
  cancel(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.cancel, async ({ params }) => ({
      status: 200 as const,
      body: await this.expenses.cancel(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.expenses.remove)
  remove(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.remove, async ({ params }) => {
      await this.expenses.remove(ctx, params.id);
      return { status: 200 as const, body: ok };
    });
  }

  @TsRestHandler(apiContract.expenses.pay)
  pay(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.pay, async ({ params, body }) => ({
      status: 201 as const,
      body: await this.expenses.pay(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.expenses.removePayment)
  removePayment(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.expenses.removePayment, async ({ params }) => ({
      status: 200 as const,
      body: await this.expenses.removePayment(ctx, params.id, params.paymentId),
    }));
  }
}
