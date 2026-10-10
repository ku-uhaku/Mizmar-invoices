import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesSchedulerService } from './expenses-scheduler.service';
import { ExpensesService } from './expenses.service';

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpensesSchedulerService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
