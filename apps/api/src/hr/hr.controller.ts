import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { moduleContract } from '@mizmar/contracts';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { AttendanceService } from './attendance.service';
import { HrService } from './hr.service';
import { LeaveService } from './leave.service';

const hr = moduleContract.hr;
const ok = { ok: true as const };

@Controller()
export class HrController {
  constructor(
    private readonly employees: HrService,
    private readonly leave: LeaveService,
    private readonly attendance: AttendanceService,
  ) {}

  @TsRestHandler(hr.overview)
  overview(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.overview, async () => ({
      status: 200 as const,
      body: await this.employees.overview(ctx),
    }));
  }

  @TsRestHandler(hr.listDepartments)
  listDepartments(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.listDepartments, async () => ({
      status: 200 as const,
      body: await this.employees.listDepartments(ctx),
    }));
  }

  @TsRestHandler(hr.createDepartment)
  createDepartment(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.createDepartment, async ({ body }) => ({
      status: 201 as const,
      body: await this.employees.createDepartment(ctx, body),
    }));
  }

  @TsRestHandler(hr.updateDepartment)
  updateDepartment(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.updateDepartment, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.employees.updateDepartment(ctx, params.id, body),
    }));
  }

  @TsRestHandler(hr.removeDepartment)
  removeDepartment(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.removeDepartment, async ({ params }) => {
      await this.employees.removeDepartment(ctx, params.id);
      return { status: 200 as const, body: ok };
    });
  }

  @TsRestHandler(hr.listEmployees)
  listEmployees(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.listEmployees, async ({ query }) => ({
      status: 200 as const,
      body: await this.employees.listEmployees(ctx, query),
    }));
  }

  @TsRestHandler(hr.createEmployee)
  createEmployee(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.createEmployee, async ({ body }) => ({
      status: 201 as const,
      body: await this.employees.createEmployee(ctx, body),
    }));
  }

  @TsRestHandler(hr.getEmployee)
  getEmployee(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.getEmployee, async ({ params }) => ({
      status: 200 as const,
      body: await this.employees.getEmployee(ctx, params.id),
    }));
  }

  @TsRestHandler(hr.updateEmployee)
  updateEmployee(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.updateEmployee, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.employees.updateEmployee(ctx, params.id, body),
    }));
  }

  @TsRestHandler(hr.listContracts)
  listContracts(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.listContracts, async ({ params }) => ({
      status: 200 as const,
      body: await this.employees.listContracts(ctx, params.id),
    }));
  }

  @TsRestHandler(hr.createContract)
  createContract(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.createContract, async ({ params, body }) => ({
      status: 201 as const,
      body: await this.employees.createContract(ctx, params.id, body),
    }));
  }

  @TsRestHandler(hr.listLeaveTypes)
  listLeaveTypes(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.listLeaveTypes, async () => ({
      status: 200 as const,
      body: await this.leave.listTypes(ctx),
    }));
  }

  @TsRestHandler(hr.createLeaveType)
  createLeaveType(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.createLeaveType, async ({ body }) => ({
      status: 201 as const,
      body: await this.leave.createType(ctx, body),
    }));
  }

  @TsRestHandler(hr.updateLeaveType)
  updateLeaveType(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.updateLeaveType, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.leave.updateType(ctx, params.id, body),
    }));
  }

  @TsRestHandler(hr.leaveBalances)
  leaveBalances(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.leaveBalances, async ({ query }) => ({
      status: 200 as const,
      body: await this.leave.balances(ctx, query.year),
    }));
  }

  @TsRestHandler(hr.listLeave)
  listLeave(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.listLeave, async ({ query }) => ({
      status: 200 as const,
      body: await this.leave.list(ctx, query),
    }));
  }

  @TsRestHandler(hr.createLeave)
  createLeave(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.createLeave, async ({ body }) => ({
      status: 201 as const,
      body: await this.leave.create(ctx, body),
    }));
  }

  @TsRestHandler(hr.decideLeave)
  decideLeave(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.decideLeave, async ({ params, body }) => ({
      status: 200 as const,
      body: await this.leave.decide(ctx, params.id, body.approve),
    }));
  }

  @TsRestHandler(hr.cancelLeave)
  cancelLeave(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.cancelLeave, async ({ params }) => ({
      status: 200 as const,
      body: await this.leave.cancel(ctx, params.id),
    }));
  }

  @TsRestHandler(hr.attendanceDay)
  attendanceDay(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.attendanceDay, async ({ query }) => ({
      status: 200 as const,
      body: await this.attendance.day(ctx, query.date),
    }));
  }

  @TsRestHandler(hr.saveAttendance)
  saveAttendance(@Ctx() ctx: RequestContext) {
    return tsRestHandler(hr.saveAttendance, async ({ body }) => ({
      status: 200 as const,
      body: await this.attendance.save(ctx, body),
    }));
  }
}
