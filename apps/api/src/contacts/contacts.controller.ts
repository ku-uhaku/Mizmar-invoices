import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { ContactsService } from './contacts.service';

@Controller()
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @TsRestHandler(apiContract.contacts.list)
  list(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.contacts.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.contacts.list(ctx, query),
    }));
  }

  @TsRestHandler(apiContract.contacts.create)
  create(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.contacts.create, async ({ body }) => ({
      status: 201 as const,
      body: await this.contacts.create(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.contacts.get)
  get(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.contacts.get, async ({ params }) => ({
      status: 200 as const,
      body: await this.contacts.get(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.contacts.update)
  update(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.contacts.update, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.contacts.update(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.contacts.remove)
  remove(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.contacts.remove, async ({ params }) => {
      await this.contacts.remove(ctx, params.id);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @TsRestHandler(apiContract.contacts.setOpeningBalance)
  setOpeningBalance(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.contacts.setOpeningBalance, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.contacts.setOpeningBalance(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.contacts.statement)
  statement(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.contacts.statement, async ({ params, query }) => ({
      status: 200 as const,
      body: await this.contacts.statement(ctx, params.id, query),
    }));
  }
}
