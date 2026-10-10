import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { moduleContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { AccountingService } from './accounting.service';

const c = moduleContract.accounting;

@Controller()
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @TsRestHandler(c.listAccounts)
  listAccounts(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.listAccounts, async () => ({ status: 200 as const, body: await this.accounting.listAccounts(ctx) }));
  }

  @TsRestHandler(c.createAccount)
  createAccount(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.createAccount, async ({ body }) => ({ status: 201 as const, body: await this.accounting.createAccount(ctx, body) }));
  }

  @TsRestHandler(c.updateAccount)
  updateAccount(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.updateAccount, async ({ params, body }) => ({ status: 200 as const, body: await this.accounting.updateAccount(ctx, params.id, body) }));
  }

  @TsRestHandler(c.sync)
  sync(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.sync, async () => ({ status: 200 as const, body: await this.accounting.sync(ctx) }));
  }

  @TsRestHandler(c.listEntries)
  listEntries(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.listEntries, async ({ query }) => ({ status: 200 as const, body: await this.accounting.listEntries(ctx, query) }));
  }

  @TsRestHandler(c.createEntry)
  createEntry(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.createEntry, async ({ body }) => ({ status: 201 as const, body: await this.accounting.createEntry(ctx, body) }));
  }

  @TsRestHandler(c.deleteEntry)
  deleteEntry(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.deleteEntry, async ({ params }) => {
      await this.accounting.deleteEntry(ctx, params.id);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @TsRestHandler(c.ledger)
  ledger(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.ledger, async ({ query }) => ({ status: 200 as const, body: await this.accounting.ledger(ctx, query) }));
  }

  @TsRestHandler(c.trialBalance)
  trialBalance(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.trialBalance, async ({ query }) => ({ status: 200 as const, body: await this.accounting.trialBalance(ctx, query) }));
  }
}
