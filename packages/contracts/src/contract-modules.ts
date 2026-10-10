import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { commonErrorResponses, uuid } from './common';
import * as cash from './cash';
import * as hr from './hr';
import * as payroll from './payroll';
import * as treasury from './treasury';
import * as payables from './payables';
import * as bank from './bank';
import * as accounting from './accounting';
import * as lots from './lots';
import { payment as documentsPayment } from './documents';

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

const paymentMethodsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '',
      headers: companyHeader,
      responses: { 200: z.array(treasury.paymentMethod), ...commonErrorResponses },
    },
    create: {
      method: 'POST',
      path: '',
      headers: companyHeader,
      body: treasury.paymentMethodBody,
      responses: { 201: treasury.paymentMethod, ...commonErrorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/:id',
      headers: companyHeader,
      pathParams: idParams,
      body: treasury.paymentMethodBody.partial(),
      responses: { 200: treasury.paymentMethod, ...commonErrorResponses },
    },
  },
  { pathPrefix: '/payment-methods' },
);

const chequesContract = c.router(
  {
    list: {
      method: 'GET',
      path: '',
      headers: companyHeader,
      query: treasury.chequeListQuery,
      responses: { 200: treasury.chequeListResponse, ...commonErrorResponses },
    },
    setStatus: {
      method: 'POST',
      path: '/:id/status',
      headers: companyHeader,
      pathParams: idParams,
      body: treasury.paymentStatusChange,
      responses: { 200: documentsPayment, ...commonErrorResponses },
    },
    history: {
      method: 'GET',
      path: '/:id/history',
      headers: companyHeader,
      pathParams: idParams,
      responses: { 200: z.array(treasury.paymentStatusEvent), ...commonErrorResponses },
    },
  },
  { pathPrefix: '/cheques' },
);

const payablesContract = c.router(
  {
    overview: {
      method: 'GET',
      path: '',
      headers: companyHeader,
      query: payables.payablesQuery,
      responses: { 200: payables.payablesOverview, ...commonErrorResponses },
    },
  },
  { pathPrefix: '/payables' },
);

const bankContract = c.router(
  {
    listAccounts: {
      method: 'GET',
      path: '/accounts',
      headers: companyHeader,
      responses: { 200: z.array(bank.bankAccount), ...commonErrorResponses },
    },
    createAccount: {
      method: 'POST',
      path: '/accounts',
      headers: companyHeader,
      body: bank.bankAccountBody,
      responses: { 201: bank.bankAccount, ...commonErrorResponses },
    },
    updateAccount: {
      method: 'PATCH',
      path: '/accounts/:id',
      headers: companyHeader,
      pathParams: idParams,
      body: bank.bankAccountBody.partial(),
      responses: { 200: bank.bankAccount, ...commonErrorResponses },
    },
    listLines: {
      method: 'GET',
      path: '/accounts/:id/lines',
      headers: companyHeader,
      pathParams: idParams,
      query: bank.bankLinesQuery,
      responses: { 200: z.array(bank.bankLine), ...commonErrorResponses },
    },
    importStatement: {
      method: 'POST',
      path: '/accounts/:id/import',
      headers: companyHeader,
      pathParams: idParams,
      body: bank.bankImportBody,
      responses: { 200: bank.bankImportResult, ...commonErrorResponses },
    },
    autoMatch: {
      method: 'POST',
      path: '/accounts/:id/auto-match',
      headers: companyHeader,
      pathParams: idParams,
      body: z.object({}),
      responses: { 200: bank.bankAutoMatchResult, ...commonErrorResponses },
    },
    candidates: {
      method: 'GET',
      path: '/lines/:id/candidates',
      headers: companyHeader,
      pathParams: idParams,
      responses: { 200: z.array(bank.bankCandidate), ...commonErrorResponses },
    },
    match: {
      method: 'POST',
      path: '/lines/:id/match',
      headers: companyHeader,
      pathParams: idParams,
      body: bank.bankMatchBody,
      responses: { 200: bank.bankLine, ...commonErrorResponses },
    },
    unmatch: {
      method: 'POST',
      path: '/lines/:id/unmatch',
      headers: companyHeader,
      pathParams: idParams,
      body: z.object({}),
      responses: { 200: bank.bankLine, ...commonErrorResponses },
    },
    ignore: {
      method: 'POST',
      path: '/lines/:id/ignore',
      headers: companyHeader,
      pathParams: idParams,
      body: z.object({ ignored: z.boolean() }),
      responses: { 200: bank.bankLine, ...commonErrorResponses },
    },
  },
  { pathPrefix: '/bank' },
);

const accountingContract = c.router(
  {
    listAccounts: {
      method: 'GET',
      path: '/accounts',
      headers: companyHeader,
      responses: { 200: z.array(accounting.account), ...commonErrorResponses },
    },
    createAccount: {
      method: 'POST',
      path: '/accounts',
      headers: companyHeader,
      body: accounting.accountBody,
      responses: { 201: accounting.account, ...commonErrorResponses },
    },
    updateAccount: {
      method: 'PATCH',
      path: '/accounts/:id',
      headers: companyHeader,
      pathParams: idParams,
      body: accounting.accountBody.partial(),
      responses: { 200: accounting.account, ...commonErrorResponses },
    },
    sync: {
      method: 'POST',
      path: '/sync',
      headers: companyHeader,
      body: z.object({}),
      responses: { 200: accounting.syncResult, ...commonErrorResponses },
    },
    listEntries: {
      method: 'GET',
      path: '/entries',
      headers: companyHeader,
      query: accounting.entriesQuery,
      responses: { 200: z.array(accounting.journalEntry), ...commonErrorResponses },
    },
    createEntry: {
      method: 'POST',
      path: '/entries',
      headers: companyHeader,
      body: accounting.entryBody,
      responses: { 201: accounting.journalEntry, ...commonErrorResponses },
    },
    deleteEntry: {
      method: 'DELETE',
      path: '/entries/:id',
      headers: companyHeader,
      pathParams: idParams,
      responses: { 200: ok, ...commonErrorResponses },
    },
    ledger: {
      method: 'GET',
      path: '/ledger',
      headers: companyHeader,
      query: accounting.ledgerQuery,
      responses: { 200: accounting.ledgerResponse, ...commonErrorResponses },
    },
    trialBalance: {
      method: 'GET',
      path: '/trial-balance',
      headers: companyHeader,
      query: accounting.periodQuery,
      responses: { 200: accounting.trialBalanceResponse, ...commonErrorResponses },
    },
  },
  { pathPrefix: '/accounting' },
);

const lotsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '',
      headers: companyHeader,
      query: lots.lotsQuery,
      responses: { 200: lots.lotsResponse, ...commonErrorResponses },
    },
    unassigned: {
      method: 'GET',
      path: '/unassigned',
      headers: companyHeader,
      responses: { 200: z.array(lots.unassignedItem), ...commonErrorResponses },
    },
    tracked: {
      method: 'GET',
      path: '/variants',
      headers: companyHeader,
      query: lots.trackedQuery,
      responses: { 200: z.array(lots.trackedVariant), ...commonErrorResponses },
    },
    setTracking: {
      method: 'POST',
      path: '/tracking',
      headers: companyHeader,
      body: lots.setTrackingBody,
      responses: { 200: lots.trackedVariant, ...commonErrorResponses },
    },
    assign: {
      method: 'POST',
      path: '/assign',
      headers: companyHeader,
      body: lots.assignBody,
      responses: { 201: z.array(lots.lotItem), ...commonErrorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/:id',
      headers: companyHeader,
      pathParams: idParams,
      body: lots.lotPatch,
      responses: { 200: lots.lotItem, ...commonErrorResponses },
    },
    writeOff: {
      method: 'POST',
      path: '/:id/write-off',
      headers: companyHeader,
      pathParams: idParams,
      body: lots.writeOffBody,
      responses: { 200: lots.lotItem, ...commonErrorResponses },
    },
    trace: {
      method: 'GET',
      path: '/:id/trace',
      headers: companyHeader,
      pathParams: idParams,
      responses: { 200: z.array(lots.traceItem), ...commonErrorResponses },
    },
    generateBarcodes: {
      method: 'POST',
      path: '/barcodes',
      headers: companyHeader,
      body: lots.barcodesBody,
      responses: { 200: lots.barcodesResult, ...commonErrorResponses },
    },
  },
  { pathPrefix: '/lots' },
);

export const moduleContract = c.router(
  {
    lots: lotsContract,
    accounting: accountingContract,
    bank: bankContract,
    payables: payablesContract,
    paymentMethods: paymentMethodsContract,
    cheques: chequesContract,
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
