import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { SettingsService } from './settings.service';

@Controller()
export class CompaniesController {
  constructor(private readonly settings: SettingsService) {}

  @TsRestHandler(apiContract.companies.list)
  list(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.companies.list, async () => ({
      status: 200 as const,
      body: await this.settings.listCompanies(ctx),
    }));
  }

  @TsRestHandler(apiContract.companies.create)
  create(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.companies.create, async ({ body }) => ({
      status: 201 as const,
      body: await this.settings.createCompany(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.companies.get)
  get(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.companies.get, async ({ params }) => ({
      status: 200 as const,
      body: await this.settings.getCompany(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.companies.update)
  update(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.companies.update, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.settings.updateCompany(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.companies.listVatRates)
  listVatRates(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.companies.listVatRates, async ({ params }) => ({
      status: 200 as const,
      body: await this.settings.listVatRates(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.companies.replaceVatRates)
  replaceVatRates(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.companies.replaceVatRates, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.settings.replaceVatRates(ctx, params.id, body.rates),
    }));
  }

  @TsRestHandler(apiContract.companies.listNumberSequences)
  listNumberSequences(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.companies.listNumberSequences, async ({ params, query }) => ({
      status: 200 as const,
      body: await this.settings.listNumberSequences(ctx, params.id, query.year),
    }));
  }

  @TsRestHandler(apiContract.companies.updateNumberSequence)
  updateNumberSequence(@Ctx() ctx: RequestContext) {
    return tsRestHandler(
      apiContract.companies.updateNumberSequence,
      async ({ params, body }) => ({
        status: 200 as const,
        body: await this.settings.updateNumberSequence(ctx, params.id, params.sequenceId, body),
      }),
    );
  }
}

@Controller()
export class MembersController {
  constructor(private readonly settings: SettingsService) {}

  @TsRestHandler(apiContract.members.list)
  list(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.members.list, async () => ({
      status: 200 as const,
      body: await this.settings.listMembers(ctx),
    }));
  }

  @TsRestHandler(apiContract.members.invite)
  invite(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.members.invite, async ({ body }) => ({
      status: 201 as const,
      body: await this.settings.inviteMember(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.members.update)
  update(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.members.update, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.settings.updateMember(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.members.remove)
  remove(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.members.remove, async ({ params }) => {
      await this.settings.removeMember(ctx, params.id);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }
}

@Controller()
export class TemplatesController {
  constructor(private readonly settings: SettingsService) {}

  @TsRestHandler(apiContract.templates.list)
  list(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.templates.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.settings.listTemplates(ctx, query.documentType),
    }));
  }

  @TsRestHandler(apiContract.templates.create)
  create(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.templates.create, async ({ body }) => ({
      status: 201 as const,
      body: await this.settings.createTemplate(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.templates.get)
  get(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.templates.get, async ({ params }) => ({
      status: 200 as const,
      body: await this.settings.getTemplate(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.templates.update)
  update(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.templates.update, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.settings.updateTemplate(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.templates.remove)
  remove(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.templates.remove, async ({ params }) => {
      await this.settings.removeTemplate(ctx, params.id);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @TsRestHandler(apiContract.templates.preview)
  preview(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.templates.preview, async ({ body }) => ({
      status: 200 as const,
      body: await this.settings.previewTemplate(ctx, body),
    }));
  }
}
