import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module';
import {
  CompaniesController,
  MembersController,
  TemplatesController,
} from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  // The configurator's live preview is rendered by the same service that
  // produces the PDF, which is what keeps the two in step.
  imports: [PdfModule],
  controllers: [CompaniesController, MembersController, TemplatesController],
  providers: [SettingsService],
})
export class SettingsModule {}
