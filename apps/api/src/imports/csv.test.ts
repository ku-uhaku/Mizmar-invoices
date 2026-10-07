import { describe, expect, it } from 'vitest';
import { CsvError, detectDelimiter, parseCsv, toCsv } from './csv';

const cells = (text: string, opts = {}) => parseCsv(text, opts).records.map((r) => r.cells);

describe('parseCsv', () => {
  it('parses a simple comma file', () => {
    expect(cells('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles CRLF, CR and a trailing newline', () => {
    expect(cells('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(cells('a,b\r1,2\r')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('strips a UTF-8 BOM', () => {
    const r = parseCsv('﻿name;sku\nx;y');
    expect(r.records[0]!.cells).toEqual(['name', 'sku']);
    expect(r.delimiter).toBe(';');
  });

  it('keeps delimiters, doubled quotes and newlines inside quotes', () => {
    const r = cells('a,b\n"x, y","say ""hi"""\n"line1\nline2",z');
    expect(r[1]).toEqual(['x, y', 'say "hi"']);
    expect(r[2]).toEqual(['line1\nline2', 'z']);
  });

  it('preserves CRLF inside a quoted field', () => {
    expect(cells('a\n"x\r\ny"')[1]).toEqual(['x\r\ny']);
  });

  it('tracks the starting line across embedded newlines', () => {
    const r = parseCsv('a,b\n"x\ny",1\nlast,2').records;
    expect(r.map((x) => x.line)).toEqual([1, 2, 4]);
  });

  it('skips blank lines but keeps rows of empty cells', () => {
    const r = cells('a,b\n\n1,2\n,\n');
    expect(r).toEqual([['a', 'b'], ['1', '2'], ['', '']]);
  });

  it('keeps an explicitly quoted empty value as a row', () => {
    expect(cells('a\n""')).toEqual([['a'], ['']]);
  });

  it('keeps empty trailing cells', () => {
    expect(cells('a,b,c\n1,,')).toEqual([['a', 'b', 'c'], ['1', '', '']]);
  });

  it('is lenient with a stray quote in the middle of a field', () => {
    expect(cells('a\n5" pipe')).toEqual([['a'], ['5" pipe']]);
  });

  it('does not treat formulas specially', () => {
    expect(cells('a\n=1+1')[1]).toEqual(['=1+1']);
  });

  it('throws on an unterminated quote', () => {
    expect(() => parseCsv('a\n"oops')).toThrow(CsvError);
    try {
      parseCsv('a\n"oops');
    } catch (e) {
      expect((e as CsvError).code).toBe('UNTERMINATED_QUOTE');
      expect((e as CsvError).line).toBe(2);
    }
  });

  it('throws on an empty file', () => {
    expect(() => parseCsv('')).toThrow(/empty/i);
    expect(() => parseCsv('\n\n')).toThrow(/empty/i);
  });

  it('enforces the row cap', () => {
    const text = 'h\n' + Array.from({ length: 11 }, (_, i) => String(i)).join('\n');
    expect(() => parseCsv(text, { maxRows: 11 })).toThrow(/more than 10/);
    expect(() => parseCsv('h\n' + '1\n'.repeat(10), { maxRows: 11 })).not.toThrow();
  });

  it('enforces the byte cap', () => {
    expect(() => parseCsv('a\n' + 'x'.repeat(100), { maxBytes: 50 })).toThrow(/larger than/);
  });

  it('honours an explicit delimiter', () => {
    expect(cells('a;b,c\n1;2,3', { delimiter: ',' })[0]).toEqual(['a;b', 'c']);
  });
});

describe('detectDelimiter', () => {
  it('detects ; , and tab', () => {
    expect(detectDelimiter('a;b;c\n')).toBe(';');
    expect(detectDelimiter('a,b,c\n')).toBe(',');
    expect(detectDelimiter('a\tb\tc\n')).toBe('\t');
  });

  it('ignores delimiters inside quotes', () => {
    expect(detectDelimiter('"a,b,c";d\n')).toBe(';');
  });

  it('defaults to comma', () => {
    expect(detectDelimiter('single\n')).toBe(',');
  });

  it('only looks at the header line', () => {
    expect(detectDelimiter('a;b\n1,2,3,4\n')).toBe(';');
  });
});

describe('toCsv', () => {
  it('round-trips quotes, delimiters and newlines', () => {
    const rows = [['a;b', 'say "hi"', 'x\ny'], ['1', '', '3']];
    const text = toCsv(rows, ';');
    expect(parseCsv(text, { delimiter: ';' }).records.map((r) => r.cells)).toEqual(rows);
  });
});
