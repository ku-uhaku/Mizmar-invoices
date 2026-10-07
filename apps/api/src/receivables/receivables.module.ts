import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { PdfModule } from '../pdf/pdf.module';
import { ReceivablesController } from './receivables.controller';
import { ReceivablesService } from './receivables.service';

@Module({
  imports: [MailModule, PdfModule],
  controllers: [ReceivablesController],
  providers: [ReceivablesService],
})
export class ReceivablesModule {}
