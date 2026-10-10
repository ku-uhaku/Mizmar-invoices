import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract, moduleContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { DocumentsService } from './documents.service';
import { DocumentDeliveryService } from './document-delivery.service';

@Controller()
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly delivery: DocumentDeliveryService,
  ) {}

  @TsRestHandler(apiContract.documents.list)
  list(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.documents.list(ctx, query),
    }));
  }

  @TsRestHandler(apiContract.documents.create)
  create(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.create, async ({ body }) => ({
      status: 201 as const,
      body: await this.documents.create(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.documents.get)
  get(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.get, async ({ params }) => ({
      status: 200 as const,
      body: await this.documents.get(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.documents.update)
  update(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.update, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.documents.update(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.documents.remove)
  remove(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.remove, async ({ params }) => {
      await this.documents.remove(ctx, params.id);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @TsRestHandler(apiContract.documents.duplicate)
  duplicate(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.duplicate, async ({ params, body }) => ({
      status: 201 as const,
      body: await this.documents.duplicate(ctx, params.id, body.issueDate),
    }));
  }

  @TsRestHandler(apiContract.documents.validationPreview)
  validationPreview(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.validationPreview, async ({ params }) => ({
      status: 200 as const,
      body: await this.documents.validationPreview(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.documents.validate)
  validate(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.validate, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.documents.validate(ctx, params.id, body.confirmNegativeStock),
    }));
  }

  @TsRestHandler(apiContract.documents.markSent)
  markSent(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.markSent, async ({ params }) => ({
      status: 200 as const,
      body: await this.documents.markSent(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.documents.cancel)
  cancel(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.cancel, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.documents.cancel(ctx, params.id, body.reason),
    }));
  }

  @TsRestHandler(apiContract.documents.conversionOptions)
  conversionOptions(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.conversionOptions, async ({ params, query }) => {
      // The query accepts one id or many, so the dialog can consolidate.
      const alsoInclude =
        query.alsoInclude === undefined
          ? []
          : Array.isArray(query.alsoInclude)
            ? query.alsoInclude
            : [query.alsoInclude];

      return {
        status: 200 as const,
        body: await this.documents.conversionOptions(ctx, params.id, query.targetType, alsoInclude),
      };
    });
  }

  @TsRestHandler(apiContract.documents.convert)
  convert(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.convert, async ({ body }) => ({
      status: 201 as const,
      body: await this.documents.convert(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.documents.renderPdf)
  renderPdf(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.renderPdf, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.delivery.renderPdf(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.documents.sendEmail)
  sendEmail(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.sendEmail, async ({ params, body }) => {
      await this.delivery.sendByEmail(ctx, params.id, body);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @TsRestHandler(moduleContract.whatsapp.sendDocument)
  sendWhatsapp(@Ctx() ctx: RequestContext) {
    return tsRestHandler(moduleContract.whatsapp.sendDocument, async ({ params, body }) => {
      await this.delivery.sendByWhatsapp(ctx, params.id, body);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @TsRestHandler(apiContract.documents.totalsPreview)
  totalsPreview(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.documents.totalsPreview, async ({ body }) => ({
      status: 200 as const,
      body: await this.documents.totalsPreview(ctx, body),
    }));
  }
}
