import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PdfModule } from '../pdf/pdf.module';
import { DocumentDeliveryService } from './document-delivery.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { NumberingService } from './numbering.service';

@Module({
  imports: [InventoryModule, PdfModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, NumberingService, DocumentDeliveryService],
  exports: [DocumentsService, NumberingService],
})
export class DocumentsModule {}
