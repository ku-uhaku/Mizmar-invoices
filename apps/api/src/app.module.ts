import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { TsRestModule } from '@ts-rest/nest';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { AuditModule } from './audit/audit.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { HealthModule } from './health/health.module';
import { CatalogModule } from './catalog/catalog.module';
import { ContactsModule } from './contacts/contacts.module';
import { DocumentsModule } from './documents/documents.module';
import { ImportsModule } from './imports/imports.module';
import { InventoryModule } from './inventory/inventory.module';
import { MailModule } from './mail/mail.module';
import { PaymentsModule } from './payments/payments.module';
import { PdfModule } from './pdf/pdf.module';
import { PricingModule } from './pricing/pricing.module';
import { SettingsModule } from './settings/settings.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReceivablesModule } from './receivables/receivables.module';
import { PayablesModule } from './payables/payables.module';
import { BankModule } from './bank/bank.module';
import { AccountingModule } from './accounting/accounting.module';
import { LotsModule } from './lots/lots.module';
import { ReportsModule } from './reports/reports.module';
import { RecurringModule } from './recurring/recurring.module';
import { ExpensesModule } from './expenses/expenses.module';
import { HrModule } from './hr/hr.module';
import { PayrollModule } from './payroll/payroll.module';
import { CashModule } from './cash/cash.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The API lives in a monorepo; the env file is at the workspace root and
      // symlinked here, so both layouts resolve.
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
      cache: true,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
            : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password'],
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      },
    }),
    TsRestModule.register({
      // Zod validates every request body, query and header against the
      // contract. Responses are validated outside production, so a drift
      // between contract and handler fails a test rather than a client.
      validateRequestBody: true,
      validateRequestQuery: true,
      validateRequestHeaders: true,
      validateResponses: process.env.NODE_ENV !== 'production',
      // Query strings carry arrays and nested filters, so they are JSON-encoded.
      jsonQuery: true,
      isGlobal: true,
    }),
    PrismaModule,
    StorageModule,
    AuthModule,
    AuditModule,
    HealthModule,
    ContactsModule,
    CatalogModule,
    InventoryModule,
    MailModule,
    PdfModule,
    DocumentsModule,
    PaymentsModule,
    SettingsModule,
    DashboardModule,
    ImportsModule,
    ReceivablesModule,
    ReportsModule,
    PricingModule,
    RecurringModule,
    ExpensesModule,
    HrModule,
    PayrollModule,
    CashModule,
    PayablesModule,
    BankModule,
    AccountingModule,
    LotsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    // Runs after the guard, so the request context is available to scope the
    // stored key to its organization.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    // Declared after idempotency so replayed requests are never logged twice.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
