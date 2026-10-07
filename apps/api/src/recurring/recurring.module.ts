import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { RecurringController } from './recurring.controller';
import { RecurringRunnerService } from './recurring-runner.service';
import { RecurringSchedulerService } from './recurring-scheduler.service';
import { RecurringService } from './recurring.service';

@Module({
  imports: [DocumentsModule, AuthModule],
  controllers: [RecurringController],
  providers: [RecurringService, RecurringRunnerService, RecurringSchedulerService],
})
export class RecurringModule {}
