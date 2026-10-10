import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { moduleContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { BankService } from './bank.service';

const c = moduleContract.bank;

@Controller()
export class BankController {
  constructor(private readonly bank: BankService) {}

  @TsRestHandler(c.listAccounts)
  listAccounts(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.listAccounts, async () => ({ status: 200 as const, body: await this.bank.listAccounts(ctx) }));
  }

  @TsRestHandler(c.createAccount)
  createAccount(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.createAccount, async ({ body }) => ({ status: 201 as const, body: await this.bank.createAccount(ctx, body) }));
  }

  @TsRestHandler(c.updateAccount)
  updateAccount(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.updateAccount, async ({ params, body }) => ({ status: 200 as const, body: await this.bank.updateAccount(ctx, params.id, body) }));
  }

  @TsRestHandler(c.listLines)
  listLines(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.listLines, async ({ params, query }) => ({ status: 200 as const, body: await this.bank.listLines(ctx, params.id, query) }));
  }

  @TsRestHandler(c.importStatement)
  importStatement(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.importStatement, async ({ params, body }) => ({ status: 200 as const, body: await this.bank.importStatement(ctx, params.id, body.csv) }));
  }

  @TsRestHandler(c.autoMatch)
  autoMatch(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.autoMatch, async ({ params }) => ({ status: 200 as const, body: await this.bank.autoMatch(ctx, params.id) }));
  }

  @TsRestHandler(c.candidates)
  candidates(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.candidates, async ({ params }) => ({ status: 200 as const, body: await this.bank.candidates(ctx, params.id) }));
  }

  @TsRestHandler(c.match)
  match(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.match, async ({ params, body }) => ({ status: 200 as const, body: await this.bank.match(ctx, params.id, body) }));
  }

  @TsRestHandler(c.unmatch)
  unmatch(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.unmatch, async ({ params }) => ({ status: 200 as const, body: await this.bank.unmatch(ctx, params.id) }));
  }

  @TsRestHandler(c.ignore)
  ignore(@Ctx() ctx: RequestContext) {
    return tsRestHandler(c.ignore, async ({ params, body }) => ({ status: 200 as const, body: await this.bank.ignore(ctx, params.id, body.ignored) }));
  }
}
