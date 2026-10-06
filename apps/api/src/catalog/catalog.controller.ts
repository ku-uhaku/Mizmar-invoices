import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { CatalogService } from './catalog.service';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @TsRestHandler(apiContract.catalog.listAttributeTypes)
  listAttributeTypes(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.catalog.listAttributeTypes, async () => ({
      status: 200 as const,
      body: await this.catalog.listAttributeTypes(ctx),
    }));
  }

  @TsRestHandler(apiContract.catalog.createAttributeType)
  createAttributeType(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.catalog.createAttributeType, async ({ body }) => ({
      status: 201 as const,
      body: await this.catalog.createAttributeType(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.catalog.updateAttributeType)
  updateAttributeType(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.catalog.updateAttributeType, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.catalog.updateAttributeType(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.catalog.listProducts)
  listProducts(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.catalog.listProducts, async ({ query }) => ({
      status: 200 as const,
      body: await this.catalog.listProducts(ctx, query),
    }));
  }

  @TsRestHandler(apiContract.catalog.createProduct)
  createProduct(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.catalog.createProduct, async ({ body }) => ({
      status: 201 as const,
      body: await this.catalog.createProduct(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.catalog.getProduct)
  getProduct(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.catalog.getProduct, async ({ params }) => ({
      status: 200 as const,
      body: await this.catalog.getProduct(ctx, params.id),
    }));
  }

  @TsRestHandler(apiContract.catalog.updateProduct)
  updateProduct(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.catalog.updateProduct, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.catalog.updateProduct(ctx, params.id, body),
    }));
  }

  @TsRestHandler(apiContract.catalog.removeProduct)
  removeProduct(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.catalog.removeProduct, async ({ params }) => {
      await this.catalog.removeProduct(ctx, params.id);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @TsRestHandler(apiContract.catalog.variantMatrix)
  variantMatrix(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.catalog.variantMatrix, async ({ body }) => ({
      status: 200 as const,
      body: await this.catalog.variantMatrix(ctx, body),
    }));
  }

  @TsRestHandler(apiContract.catalog.searchVariants)
  searchVariants(@Ctx() ctx: RequestContext) {
    return tsRestHandler(apiContract.catalog.searchVariants, async ({ query }) => ({
      status: 200 as const,
      body: await this.catalog.searchVariants(ctx, query),
    }));
  }
}
