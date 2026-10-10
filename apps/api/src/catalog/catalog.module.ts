import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductImagesController } from './product-images.controller';
import { ProductImagesService } from './product-images.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  // Opening stock is written through the stock ledger, not inserted directly.
  imports: [InventoryModule],
  controllers: [CatalogController, ProductImagesController],
  providers: [CatalogService, ProductImagesService],
  exports: [CatalogService],
})
export class CatalogModule {}
