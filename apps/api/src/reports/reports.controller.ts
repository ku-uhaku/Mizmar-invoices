import { Controller, Get, Query, Res } from '@nestjs/common';
import { reportSchemas } from '@mizmar/contracts';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { Ctx } from '../common/decorators/ctx.decorator';
import type { RequestContext } from '../tenancy/request-context';
import { toCsv, type CsvCell } from './csv';
import { ReportsService } from './reports.service';

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw AppError.badRequest('VALIDATION_FAILED', 'Invalid report parameters', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/**
 * Reports return JSON, or a spreadsheet-friendly CSV with `?format=csv`.
 * They are plain controllers rather than ts-rest routes because a file
 * download does not fit a typed JSON response.
 */
@Controller('api/v1/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales')
  async sales(
    @Ctx() ctx: RequestContext,
    @Query() raw: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const query = parse(reportSchemas.salesReportQuery, raw);
    const report = await this.reports.sales(ctx, query);
    if (query.format !== 'csv') return report;

    const showQty = query.groupBy === 'product';
    const heading =
      query.groupBy === 'period' ? 'Period' : query.groupBy === 'customer' ? 'Customer' : 'Product';
    return csv(
      reply,
      `sales-by-${query.groupBy}-${query.from}-${query.to}.csv`,
      [
        [heading, 'Documents', ...(showQty ? ['Quantity'] : []), 'Total excl. VAT', 'VAT', 'Total incl. VAT'],
        ...report.rows.map((row) => [
          row.label,
          row.documentCount,
          ...(showQty ? [row.quantity] : []),
          row.totalExclVat,
          row.totalVat,
          row.totalInclVat,
        ]),
        [
          'Total',
          null,
          ...(showQty ? [null] : []),
          report.totals.totalExclVat,
          report.totals.totalVat,
          report.totals.totalInclVat,
        ],
      ],
      query.decimal,
    );
  }

  @Get('vat')
  async vat(
    @Ctx() ctx: RequestContext,
    @Query() raw: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const query = parse(reportSchemas.vatReportQuery, raw);
    const report = await this.reports.vat(ctx, query);
    if (query.format !== 'csv') return report;

    const section = (name: string, side: typeof report.sales): CsvCell[][] => [
      [name, null, null],
      ...side.rows.map((row) => [`${row.rate} %`, row.base, row.vat]),
      ['Total', side.totalBase, side.totalVat],
      [null, null, null],
    ];
    return csv(
      reply,
      `vat-${query.from}-${query.to}.csv`,
      [
        ['VAT rate', 'Taxable base', 'VAT'],
        ...section('Sales (output VAT)', report.sales),
        ...section('Purchases (input VAT)', report.purchases),
        ['Net VAT due', null, report.netVatDue],
      ],
      query.decimal,
    );
  }

  @Get('statement')
  async statement(
    @Ctx() ctx: RequestContext,
    @Query() raw: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const query = parse(reportSchemas.statementReportQuery, raw);
    const report = await this.reports.statement(ctx, query);
    if (query.format !== 'csv') return report;

    return csv(
      reply,
      `${query.party}-statement-${query.from}-${query.to}.csv`,
      [
        ['Date', 'Type', 'Reference', 'Label', 'Debit', 'Credit', 'Balance'],
        [report.from, 'OPENING', null, report.contactName, null, null, report.openingBalance],
        ...report.rows.map((row) => [
          row.date,
          row.kind,
          row.reference,
          row.label,
          row.debit,
          row.credit,
          row.balance,
        ]),
        [report.to, 'CLOSING', null, report.contactName, report.totalDebit, report.totalCredit, report.closingBalance],
      ],
      query.decimal,
    );
  }

  @Get('stock-valuation')
  async stockValuation(
    @Ctx() ctx: RequestContext,
    @Query() raw: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const query = parse(reportSchemas.stockValuationQuery, raw);
    const report = await this.reports.stockValuation(ctx, query);
    if (query.format !== 'csv') return report;

    return csv(
      reply,
      'stock-valuation.csv',
      [
        ['Warehouse', 'SKU', 'Product', 'Variant', 'On hand', 'Average cost', 'Value'],
        ...report.rows.map((row) => [
          row.warehouseCode,
          row.sku,
          row.productName,
          row.variantLabel,
          row.onHand,
          row.averageCost,
          row.value,
        ]),
        ['Total', null, null, null, null, null, report.totalValue],
      ],
      query.decimal,
    );
  }
}

function csv(
  reply: FastifyReply,
  fileName: string,
  rows: CsvCell[][],
  decimal: 'dot' | 'comma',
): string {
  void reply.header('content-type', 'text/csv; charset=utf-8');
  void reply.header('content-disposition', `attachment; filename="${fileName}"`);
  return toCsv(rows, { separator: ';', decimalComma: decimal === 'comma' });
}
