import { Module } from '@nestjs/common';
import { HrModule } from '../hr/hr.module';
import { AnalyticsService } from './analytics.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [HrModule],
  controllers: [ReportsController],
  providers: [ReportsService, AnalyticsService],
})
export class ReportsModule {}
