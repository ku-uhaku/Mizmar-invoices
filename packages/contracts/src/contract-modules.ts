import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { commonErrorResponses, uuid } from './common';
import * as cash from './cash';
import * as hr from './hr';
import * as payroll from './payroll';

/**
 * Modules that live in their own router: the main `apiContract` type had grown
 * past what the compiler can serialise into a declaration file.
 */
const c = initContract();

const ok = z.object({ ok: z.literal(true) });
const companyHeader = z.object({ 'x-company-id': uuid.optional() });
const idParams = z.object({ id: uuid });

const hrContract = c.router(
  {
    overview: {
      method: 'GET',
      path: '/overview',
      headers: companyHeader,
      responses: { 200: hr.hrOverview, ...commonErrorResponses },
    },
    listDepartments: {
      method: 'GET',
      path: '/departments',
      headers: companyHeader,
      responses: { 200: z.array(hr.department), ...commonErrorResponses },
    },
    createDepartment: {
      method: 'POST',
      path: '/departments',
      headers: companyHeader,
      body: hr.departmentBody,
      responses: { 201: hr.department, ...commonErrorResponses },
    },
    updateDepartment: {
      method: 'PATCH',
      path: '/departments/:id',
      headers: companyHeader,
      pathParams: idParams,
      body: hr.departmentBody,
      responses: { 200: hr.department, ...commonErrorResponses },
    },
    removeDepartment: {
      method: 'DELETE',
      path: '/departments/:id',
      headers: companyHeader,
      pathParams: idParams,
      responses: { 200: ok, ...commonErrorResponses },
    },
    listEmployees: {
      method: 'GET',
      path: '/employees',
      headers: companyHeader,
      query: hr.employeeListQuery,
      responses: { 200: z.array(hr.employee), ...commonErrorResponses },
    },
    createEmployee: {
      method: 'POST',
      path: '/employees',
      headers: companyHeader,
      body: hr.employeeCreate,
      responses: { 201: hr.employee, ...commonErrorResponses },
    },
    getEmployee: {
      method: 'GET',
      path: '/employees/:id',
      headers: companyHeader,
      pathParams: idParams,
      responses: { 200: hr.employee, ...commonErrorResponses },
    },
    updateEmployee: {
      method: 'PATCH',
      path: '/employees/:id',
      headers: companyHeader,
      pathParams: idParams,
      body: hr.employeeUpdate,
      responses: { 200: hr.employee, ...commonErrorResponses },
    },
    listContracts: {
      method: 'GET',
      path: '/employees/:id/contracts',
      headers: companyHeader,
      pathParams: idParams,
      responses: { 200: z.array(hr.contract), ...commonErrorResponses },
    },
    createContract: {
      method: 'POST',
      path: '/employees/:id/contracts',
      headers: companyHeader,
      pathParams: idParams,
      body: hr.contractBody,
      responses: { 201: hr.contract, ...commonErrorResponses },
    },
    listLeaveTypes: {
      method: 'GET',
      path: '/leave-types',
      headers: companyHeader,
      responses: { 200: z.array(hr.leaveType), ...commonErrorResponses },
    },
    createLeaveType: {
      method: 'POST',
      path: '/leave-types',
      headers: companyHeader,
      body: hr.leaveTypeBody,
      responses: { 201: hr.leaveType, ...commonErrorResponses },
    },
    updateLeaveType: {
      method: 'PATCH',
      path: '/leave-types/:id',
      headers: companyHeader,
      pathParams: idParams,
      body: hr.leaveTypeBody.partial(),
      responses: { 200: hr.leaveType, ...commonErrorResponses },
    },
    leaveBalances: {
      method: 'GET',
      path: '/leave/balances',
      headers: companyHeader,
      query: hr.leaveBalanceQuery,
      responses: { 200: z.array(hr.leaveBalanceRow), ...commonErrorResponses },
    },
    listLeave: {
      method: 'GET',
      path: '/leave',
      headers: companyHeader,
      query: hr.leaveListQuery,
      responses: { 200: z.array(hr.leaveRequest), ...commonErrorResponses },
    },
    createLeave: {
      method: 'POST',
      path: '/leave',
      headers: companyHeader,
      body: hr.leaveCreate,
      responses: { 201: hr.leaveRequest, ...commonErrorResponses },
    },
    decideLeave: {
      method: 'POST',
      path: '/leave/:id/decision',
      headers: companyHeader,
      pathParams: idParams,
      body: hr.leaveDecision,
      responses: { 200: hr.leaveRequest, ...commonErrorResponses },
    },
    cancelLeave: {
      method: 'POST',
      path: '/leave/:id/cancel',
      headers: companyHeader,
      pathParams: idParams,
      body: z.object({}),
      responses: { 200: hr.leaveRequest, ...commonErrorResponses },
    },
    attendanceDay: {
      method: 'GET',
      path: '/attendance',
      headers: companyHeader,
      query: hr.attendanceDayQuery,
      responses: { 200: z.array(hr.attendanceRow), ...commonErrorResponses },
    },
    saveAttendance: {
      method: 'PUT',
      path: '/attendance',
      headers: companyHeader,
      body: hr.attendanceSave,
      responses: { 200: z.array(hr.attendanceRow), ...commonErrorResponses },
    },
  },
  { pathPrefix: '/hr' },
);

const payrollContract = c.router(
  {
    getRules: {
      method: 'GET',
      path: '/rules',
      headers: companyHeader,
      responses: { 200: payroll.payrollRulesResponse, ...commonErrorResponses },
    },
    saveRules: {
      method: 'PUT',
      path: '/rules',
      headers: companyHeader,
      body: payroll.payrollRulesSave,
      responses: { 200: payroll.payrollRulesResponse, ...commonErrorResponses },
    },
    listRuns: {
      method: 'GET',
      path: '/runs',
      headers: companyHeader,
      responses: { 200: z.array(payroll.runSummary), ...commonErrorResponses },
    },
    createRun: {
      method: 'POST',
      path: '/runs',
      headers: companyHeader,
      body: payroll.runCreate,
      responses: { 201: payroll.runDetail, ...commonErrorResponses },
    },
    getRun: {
      method: 'GET',
      path: '/runs/:id',
      headers: companyHeader,
      pathParams: idParams,
      responses: { 200: payroll.runDetail, ...commonErrorResponses },
    },
    recomputeRun: {
      method: 'POST',
      path: '/runs/:id/recompute',
      headers: companyHeader,
      pathParams: idParams,
      body: z.object({}),
      responses: { 200: payroll.runDetail, ...commonErrorResponses },
    },
    validateRun: {
      method: 'POST',
      path: '/runs/:id/validate',
      headers: companyHeader,
      pathParams: idParams,
      body: z.object({}),
      responses: { 200: payroll.runDetail, ...commonErrorResponses },
    },
    reopenRun: {
      method: 'POST',
      path: '/runs/:id/reopen',
      headers: companyHeader,
      pathParams: idParams,
      body: z.object({}),
      responses: { 200: payroll.runDetail, ...commonErrorResponses },
    },
    payRun: {
      method: 'POST',
      path: '/runs/:id/pay',
      headers: companyHeader,
      pathParams: idParams,
      body: payroll.runPay,
      responses: { 200: payroll.runDetail, ...commonErrorResponses },
    },
    removeRun: {
      method: 'DELETE',
      path: '/runs/:id',
      headers: companyHeader,
      pathParams: idParams,
      responses: { 200: ok, ...commonErrorResponses },
    },
    getPayslip: {
      method: 'GET',
      path: '/payslips/:id',
      headers: companyHeader,
      pathParams: idParams,
      responses: { 200: payroll.payslip, ...commonErrorResponses },
    },
    updatePayslip: {
      method: 'PATCH',
      path: '/payslips/:id',
      headers: companyHeader,
      pathParams: idParams,
      body: payroll.payslipUpdate,
      responses: { 200: payroll.payslip, ...commonErrorResponses },
    },
    listAdvances: {
      method: 'GET',
      path: '/advances',
      headers: companyHeader,
      responses: { 200: z.array(payroll.advance), ...commonErrorResponses },
    },
    createAdvance: {
      method: 'POST',
      path: '/advances',
      headers: companyHeader,
      body: payroll.advanceCreate,
      responses: { 201: payroll.advance, ...commonErrorResponses },
    },
    removeAdvance: {
      method: 'DELETE',
      path: '/advances/:id',
      headers: companyHeader,
      pathParams: idParams,
      responses: { 200: ok, ...commonErrorResponses },
    },
  },
  { pathPrefix: '/payroll' },
);

const cashContract = c.router(
  {
    listRegisters: {
      method: 'GET',
      path: '/registers',
      headers: companyHeader,
      responses: { 200: z.array(cash.register), ...commonErrorResponses },
    },
    createRegister: {
      method: 'POST',
      path: '/registers',
      headers: companyHeader,
      body: cash.registerBody,
      responses: { 201: cash.register, ...commonErrorResponses },
    },
    updateRegister: {
      method: 'PATCH',
      path: '/registers/:id',
      headers: companyHeader,
      pathParams: idParams,
      body: cash.registerBody.partial(),
      responses: { 200: cash.register, ...commonErrorResponses },
    },
    listSessions: {
      method: 'GET',
      path: '/sessions',
      headers: companyHeader,
      query: cash.sessionListQuery,
      responses: { 200: z.array(cash.sessionSummary), ...commonErrorResponses },
    },
    openSession: {
      method: 'POST',
      path: '/sessions',
      headers: companyHeader,
      body: cash.sessionOpen,
      responses: { 201: cash.sessionDetail, ...commonErrorResponses },
    },
    getSession: {
      method: 'GET',
      path: '/sessions/:id',
      headers: companyHeader,
      pathParams: idParams,
      responses: { 200: cash.sessionDetail, ...commonErrorResponses },
    },
    addMovement: {
      method: 'POST',
      path: '/sessions/:id/movements',
      headers: companyHeader,
      pathParams: idParams,
      body: cash.movementCreate,
      responses: { 201: cash.sessionDetail, ...commonErrorResponses },
    },
    closeSession: {
      method: 'POST',
      path: '/sessions/:id/close',
      headers: companyHeader,
      pathParams: idParams,
      body: cash.sessionClose,
      responses: { 200: cash.sessionDetail, ...commonErrorResponses },
    },
  },
  { pathPrefix: '/cash' },
);

export const moduleContract = c.router(
  {
    hr: hrContract,
    cash: cashContract,
    payroll: payrollContract,
  },
  {
    pathPrefix: '/api/v1',
    strictStatusCodes: true,
    commonResponses: {},
  },
);

export type ModuleContract = typeof moduleContract;
