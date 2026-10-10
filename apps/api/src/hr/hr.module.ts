import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { LeaveService } from './leave.service';

@Module({
  controllers: [HrController],
  providers: [HrService, LeaveService, AttendanceService],
  exports: [HrService, LeaveService, AttendanceService],
})
export class HrModule {}
