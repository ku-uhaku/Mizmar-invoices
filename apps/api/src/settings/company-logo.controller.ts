import { Controller, Delete, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../common/app-error';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { SettingsService } from './settings.service';

/**
 * Logo upload. A plain controller rather than ts-rest because the upload is
 * multipart. The picture is read back through the catalog asset endpoint.
 */
@Controller('api/v1/companies')
export class CompanyLogoController {
  constructor(private readonly settings: SettingsService) {}

  @Post(':id/logo')
  async upload(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ) {
    if (!request.isMultipart()) {
      throw AppError.badRequest('NOT_MULTIPART', 'Send the logo as multipart/form-data');
    }
    let file: { fileName: string; bytes: Buffer } | null = null;
    try {
      for await (const part of request.files()) {
        file ??= { fileName: part.filename || 'logo', bytes: await part.toBuffer() };
      }
    } catch {
      // The multipart plugin throws when a file exceeds its size limit.
      throw AppError.unprocessable('IMAGE_TOO_LARGE', 'The logo must be smaller than 2 MB');
    }
    if (!file) throw AppError.badRequest('NO_FILE', 'Choose an image');
    return this.settings.setLogo(ctx, id, file);
  }

  @Delete(':id/logo')
  remove(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.settings.removeLogo(ctx, id);
  }
}
