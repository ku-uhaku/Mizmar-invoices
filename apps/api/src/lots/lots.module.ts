import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { LotsController } from './lots.controller';
import { LotsService } from './lots.service';

@Module({
  imports: [InventoryModule],
  controllers: [LotsController],
  providers: [LotsService],
})
export class LotsModule {}
