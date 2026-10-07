/**
 * RFC 4180 CSV parser. Pure: text in, records out. Never evaluates anything.
 *
 * Handles a UTF-8 BOM, quoted fields with embedded delimiters, newlines and
 * doubled quotes, CRLF/LF/CR line endings, and ; , or tab delimiters.
 */

export type Delimiter = ',' | ';' | '\t';

export interface CsvRecord {
  /** 1-based line on which the record starts (embedded newlines count). */
  line: number;
  cells: string[];
}

export interface CsvResult {
  delimiter: Delimiter;
  records: CsvRecord[];
}

export class CsvError extends Error {
  constructor(
    readonly code: 'UNTERMINATED_QUOTE' | 'TOO_MANY_ROWS' | 'TOO_LARGE' | 'EMPTY',
    message: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = 'CsvError';
  }
}

export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_MAX_ROWS = 5000;

const CANDIDATES: Delimiter[] = [',', ';', '\t'];

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Count candidate delimiters outside quotes on the first non-empty line. */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  let seenContent = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      seenContent = true;
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (seenContent) break;
    } else if (!inQuotes && ch in counts) {
      counts[ch]!++;
      seenContent = true;
    } else if (ch.trim() !== '') {
      seenContent = true;
    }
  }
  let best: Delimiter = ',';
  let bestCount = 0;
  for (const candidate of CANDIDATES) {
    if (counts[candidate]! > bestCount) {
      best = candidate;
      bestCount = counts[candidate]!;
    }
  }
  return best;
}

export interface ParseOptions {
  delimiter?: Delimiter;
  maxRows?: number;
  maxBytes?: number;
}

/**
 * Parse CSV text. Fully blank lines are skipped. `maxRows` counts records
 * including the header, and throws as soon as it is exceeded.
 */
export function parseCsv(input: string, options: ParseOptions = {}): CsvResult {
  const maxBytes = options.maxBytes ?? CSV_MAX_BYTES;
  const maxRows = options.maxRows ?? CSV_MAX_ROWS + 1;

  if (Buffer.byteLength(input, 'utf8') > maxBytes) {
    throw new CsvError(
      'TOO_LARGE',
      `The file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB`,
    );
  }

  const text = stripBom(input);
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const records: CsvRecord[] = [];

  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  /** Whether the current field began with a quote (so "" is an empty value, not a blank line). */
  let fieldQuoted = false;
  let line = 1;
  let recordLine = 1;
  let recordHasContent = false;

  const endField = () => {
    cells.push(field);
    field = '';
    fieldQuoted = false;
  };

  const endRecord = () => {
    endField();
    const blank = cells.length === 1 && cells[0] === '' && !recordHasContent;
    if (!blank) {
      if (records.length >= maxRows) {
        throw new CsvError(
          'TOO_MANY_ROWS',
          `The file has more than ${maxRows - 1} data rows`,
        );
      }
      records.push({ line: recordLine, cells });
    }
    cells = [];
    recordHasContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        else if (ch === '\r') {
          if (text[i + 1] === '\n') {
            field += '\r\n';
            i++;
            line++;
            continue;
          }
          line++;
        }
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '' && !fieldQuoted) {
      inQuotes = true;
      fieldQuoted = true;
      recordHasContent = true;
    } else if (ch === delimiter) {
      recordHasContent = true;
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      // A stray quote mid-field is kept literally (lenient, like most readers).
      field += ch;
      recordHasContent = true;
    }
  }

  if (inQuotes) {
    throw new CsvError('UNTERMINATED_QUOTE', 'A quoted value is never closed', recordLine);
  }
  if (field !== '' || cells.length > 0 || recordHasContent) endRecord();

  if (records.length === 0) throw new CsvError('EMPTY', 'The file is empty');

  return { delimiter, records };
}

/** Serialise rows to CSV (used for templates). Quotes only where required. */
export function toCsv(rows: string[][], delimiter: Delimiter = ';'): string {
  const escape = (value: string) =>
    value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return rows.map((row) => row.map(escape).join(delimiter)).join('\r\n') + '\r\n';
}
