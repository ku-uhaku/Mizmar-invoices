export type CsvCell = string | number | null | undefined;

export interface CsvOptions {
  /** Field separator. ';' is what French-locale Excel opens without an import wizard. */
  separator?: ';' | ',';
  /** Render decimal numbers with a comma, for French-locale Excel. */
  decimalComma?: boolean;
}

const BOM = '﻿';
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
// Characters a spreadsheet treats as the start of a formula (OWASP CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Escape one cell.
 *
 * Text that begins with a formula trigger gets a leading apostrophe so Excel
 * and Sheets show it literally instead of evaluating it. Plain decimal numbers
 * are left alone: "-12.50" is a legitimate amount, not an attack.
 */
export function csvCell(value: CsvCell, options: CsvOptions = {}): string {
  const separator = options.separator ?? ';';
  if (value === null || value === undefined) return '';

  let text = typeof value === 'number' ? String(value) : value;
  const isNumber = typeof value === 'number' || PLAIN_NUMBER.test(text);

  if (isNumber) {
    if (options.decimalComma) text = text.replace('.', ',');
  } else if (FORMULA_START.test(text)) {
    text = `'${text}`;
  }

  const needsQuotes =
    text.includes(separator) ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r');

  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows to a UTF-8 CSV string with a BOM and CRLF line endings. */
export function toCsv(rows: CsvCell[][], options: CsvOptions = {}): string {
  const separator = options.separator ?? ';';
  const body = rows
    .map((row) => row.map((cell) => csvCell(cell, options)).join(separator))
    .join('\r\n');
  return `${BOM}${body}\r\n`;
}
