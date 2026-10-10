import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Req, Res } from '@nestjs/common';
import { catalogSchemas } from '@mizmar/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../common/app-error';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { MAX_IMAGE_BYTES, ProductImagesService, type IncomingImage } from './product-images.service';

/**
 * Picture upload and download. Plain controller rather than ts-rest because the
 * upload is multipart and the download is binary.
 */
@Controller('api/v1/catalog')
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Post('products/:id/images')
  async upload(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ) {
    if (!request.isMultipart()) {
      throw AppError.badRequest('NOT_MULTIPART', 'Send the pictures as multipart/form-data');
    }
    const files: IncomingImage[] = [];
    try {
      for await (const part of request.files()) {
        files.push({ fileName: part.filename || 'image', bytes: await part.toBuffer() });
      }
    } catch (error) {
      // The multipart plugin throws when a file exceeds its size or count limit.
      if (error instanceof AppError) throw error;
      throw AppError.unprocessable(
        'IMAGE_TOO_LARGE',
        `Each image must be smaller than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB (up to 10 files at once)`,
      );
    }
    return { images: await this.images.add(ctx, id, files) };
  }

  @Put('products/:id/images/order')
  async reorder(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    const body = parseBody(catalogSchemas.productImageOrder, raw);
    return { images: await this.images.reorder(ctx, id, body.imageIds) };
  }

  @Delete('products/:id/images/:imageId')
  async remove(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return { images: await this.images.remove(ctx, id, imageId) };
  }

  @Put('products/:id/variants/:variantId/image')
  async variantImage(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() raw: unknown,
  ) {
    const body = parseBody(catalogSchemas.variantImageBody, raw);
    return this.images.setVariantImage(ctx, id, variantId, body.assetId);
  }

  @Get('assets/:assetId/file')
  async file(
    @Ctx() ctx: RequestContext,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { bytes, contentType } = await this.images.read(ctx, assetId);
    // The id changes with every upload, so the bytes behind it never change.
    void reply.header('content-type', contentType);
    void reply.header('cache-control', 'private, max-age=31536000, immutable');
    return bytes;
  }
}

function parseBody<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw AppError.badRequest('VALIDATION_FAILED', 'Invalid request', {
      issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  return result.data;
}
