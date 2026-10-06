import { Module } from '@nestjs/common';
import { ChromiumService } from './chromium.service';
import { PdfService } from './pdf.service';

@Module({
  providers: [ChromiumService, PdfService],
  exports: [PdfService, ChromiumService],
})
export class PdfModule {}
