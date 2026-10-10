import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { moduleContract } from '@mizmar/contracts';
import { AppError } from '../common/app-error';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { WhatsappService } from './whatsapp.service';

@Controller()
export class WhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  /** Any signed-in user may see whether WhatsApp is available (it gates a checkbox). */
  @TsRestHandler(moduleContract.whatsapp.status)
  status() {
    return tsRestHandler(moduleContract.whatsapp.status, async () => ({
      status: 200 as const,
      body: await this.whatsapp.status(),
    }));
  }

  @TsRestHandler(moduleContract.whatsapp.qr)
  qr(@Ctx() ctx: RequestContext) {
    return tsRestHandler(moduleContract.whatsapp.qr, async () => {
      if (!ctx.ability.can('configure', 'Settings')) {
        throw AppError.forbidden('Your role may not link WhatsApp');
      }
      return { status: 200 as const, body: { qrCode: await this.whatsapp.qr() } };
    });
  }
}
