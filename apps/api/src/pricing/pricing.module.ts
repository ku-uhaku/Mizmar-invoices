import { Module } from '@nestjs/common';
import { PriceListsService } from './price-lists.service';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({
  controllers: [PricingController],
  providers: [PricingService, PriceListsService],
  exports: [PricingService],
})
export class PricingModule {}
