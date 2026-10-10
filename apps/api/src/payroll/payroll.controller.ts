import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { moduleContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { PayrollService } from './payroll.service';

const p = moduleContract.payroll;
const ok = { ok: true as const };

@Controller()
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @TsRestHandler(p.getRules)
  getRules(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.getRules, async () => ({ status: 200 as const, body: await this.payroll.getRules(ctx) }));
  }

  @TsRestHandler(p.saveRules)
  saveRules(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.saveRules, async ({ body }) => ({
      status: 200 as const,
      body: await this.payroll.saveRules(ctx, body),
    }));
  }

  @TsRestHandler(p.listRuns)
  listRuns(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.listRuns, async () => ({ status: 200 as const, body: await this.payroll.listRuns(ctx) }));
  }

  @TsRestHandler(p.createRun)
  createRun(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.createRun, async ({ body }) => ({
      status: 201 as const,
      body: await this.payroll.createRun(ctx, body),
    }));
  }

  @TsRestHandler(p.getRun)
  getRun(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.getRun, async ({ params }) => ({
      status: 200 as const,
      body: await this.payroll.getRun(ctx, params.id),
    }));
  }

  @TsRestHandler(p.recomputeRun)
  recomputeRun(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.recomputeRun, async ({ params }) => ({
      status: 200 as const,
      body: await this.payroll.recomputeRun(ctx, params.id),
    }));
  }

  @TsRestHandler(p.validateRun)
  validateRun(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.validateRun, async ({ params }) => ({
      status: 200 as const,
      body: await this.payroll.validateRun(ctx, params.id),
    }));
  }

  @TsRestHandler(p.reopenRun)
  reopenRun(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.reopenRun, async ({ params }) => ({
      status: 200 as const,
      body: await this.payroll.reopenRun(ctx, params.id),
    }));
  }

  @TsRestHandler(p.payRun)
  payRun(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.payRun, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.payroll.payRun(ctx, params.id, body),
    }));
  }

  @TsRestHandler(p.removeRun)
  removeRun(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.removeRun, async ({ params }) => {
      await this.payroll.removeRun(ctx, params.id);
      return { status: 200 as const, body: ok };
    });
  }

  @TsRestHandler(p.getPayslip)
  getPayslip(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.getPayslip, async ({ params }) => ({
      status: 200 as const,
      body: await this.payroll.getPayslip(ctx, params.id),
    }));
  }

  @TsRestHandler(p.updatePayslip)
  updatePayslip(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.updatePayslip, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.payroll.updatePayslip(ctx, params.id, body),
    }));
  }

  @TsRestHandler(p.listAdvances)
  listAdvances(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.listAdvances, async () => ({
      status: 200 as const,
      body: await this.payroll.listAdvances(ctx),
    }));
  }

  @TsRestHandler(p.createAdvance)
  createAdvance(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.createAdvance, async ({ body }) => ({
      status: 201 as const,
      body: await this.payroll.createAdvance(ctx, body),
    }));
  }

  @TsRestHandler(p.removeAdvance)
  removeAdvance(@Ctx() ctx: RequestContext) {
    return tsRestHandler(p.removeAdvance, async ({ params }) => {
      await this.payroll.removeAdvance(ctx, params.id);
      return { status: 200 as const, body: ok };
    });
  }
}
