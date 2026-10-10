import { createHash } from 'node:crypto';
import { dec } from '@mizmar/core';
import { CsvError, parseCsv, stripBom } from '../imports/csv';

export interface BankLineInput {
  line: number;
  /** ISO date (yyyy-mm-dd). */
  date: string;
  description: string;
  reference: string | null;
  /** Signed: money in is positive, money out is negative. */
  amount: string;
  balance: string | null;
  /** Stable per (date, amount, description, reference): re-importing a file adds nothing. */
  fingerprint: string;
}

export interface BankParseResult {
  lines: BankLineInput[];
  skipped: Array<{ line: number; reason: string }>;
}

const norm = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

function findColumn(headers: string[], names: string[]): number {
  for (const name of names) {
    const exact = headers.findIndex((header) => header === name);
    if (exact >= 0) return exact;
  }
  for (const name of names) {
    const partial = headers.findIndex((header) => header.includes(name));
    if (partial >= 0) return partial;
  }
  return -1;
}

/** "1 234,56", "1.234,56", "1,234.56", "(12.50)", "-12,5" -> "1234.56" ... or null. */
export function parseAmount(raw: string): string | null {
  let text = raw.replace(/[\s  ]/g, '').replace(/[A-Za-z]{3}$/, '');
  if (text === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever comes last is the decimal mark.
    text =
      lastComma > lastDot
        ? text.replace(/\./g, '').replace(',', '.')
        : text.replace(/,/g, '');
  } else if (lastComma >= 0) {
    text = text.replace(/,/g, '.');
  }
  if (!/^\d*\.?\d+$/.test(text) && !/^\d+\.$/.test(text)) return null;
  const value = dec(text);
  return (negative ? value.neg() : value).toFixed(2);
}

/** yyyy-mm-dd, dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (2- or 4-digit year) -> ISO or null. */
export function parseBankDate(raw: string): string | null {
  const text = raw.trim();
  let year: number, month: number, day: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (match) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  } else {
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
    if (!match) return null;
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
    if (year < 100) year += 2000;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export function fingerprintOf(date: string, amount: string, description: string, reference: string | null): string {
  return createHash('sha256')
    .update([date, amount, norm(description), norm(reference ?? '')].join('|'))
    .digest('hex')
    .slice(0, 40);
}

/** Read a bank statement export: debit/credit columns or one signed amount. */
export function parseBankStatement(input: string): BankParseResult {
  const { records } = parseCsv(stripBom(input));
  const header = records[0];
  if (!header) throw new CsvError('EMPTY', 'The file is empty');

  const headers = header.cells.map(norm);
  const dateCol = findColumn(headers, ['date operation', 'date', 'date valeur']);
  const descriptionCol = findColumn(headers, ['libelle', 'description', 'intitule', 'details', 'label', 'operation']);
  const debitCol = findColumn(headers, ['debit', 'retrait', 'sortie']);
  const creditCol = findColumn(headers, ['credit', 'versement', 'entree']);
  const amountCol = findColumn(headers, ['montant', 'amount']);
  const referenceCol = findColumn(headers, ['reference', 'ref', 'numero', 'n°']);
  const balanceCol = findColumn(headers, ['solde', 'balance']);

  if (dateCol < 0 || (amountCol < 0 && debitCol < 0 && creditCol < 0)) {
    throw new CsvError(
      'EMPTY',
      'Could not find the columns: a date and either an amount or debit/credit columns are required',
    );
  }

  const lines: BankLineInput[] = [];
  const skipped: BankParseResult['skipped'] = [];

  for (const record of records.slice(1)) {
    const cell = (index: number) => (index >= 0 ? (record.cells[index] ?? '').trim() : '');
    if (record.cells.every((value) => value.trim() === '')) continue;

    const date = parseBankDate(cell(dateCol));
    if (!date) {
      skipped.push({ line: record.line, reason: 'Unreadable date' });
      continue;
    }

    let amount: string | null;
    if (amountCol >= 0 && cell(amountCol) !== '') {
      amount = parseAmount(cell(amountCol));
    } else {
      const credit = parseAmount(cell(creditCol));
      const debit = parseAmount(cell(debitCol));
      amount =
        credit === null && debit === null
          ? null
          : dec(credit ?? '0').minus(dec(debit ?? '0').abs()).toFixed(2);
    }
    if (amount === null || dec(amount).isZero()) {
      skipped.push({ line: record.line, reason: 'No amount' });
      continue;
    }

    const description = cell(descriptionCol);
    const reference = cell(referenceCol) || null;
    lines.push({
      line: record.line,
      date,
      description,
      reference,
      amount,
      balance: balanceCol >= 0 ? parseAmount(cell(balanceCol)) : null,
      fingerprint: fingerprintOf(date, amount, description, reference),
    });
  }

  return { lines, skipped };
}
