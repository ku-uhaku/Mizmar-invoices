import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import {
  parseBoolean,
  parseContactKind,
  parseDecimal,
  parsePaymentTerm,
  validateContactRows,
  validateProductRows,
} from './rows';
import { contactTemplate, productTemplate } from './templates';

const products = (text: string) => validateProductRows(parseCsv(text).records);
const contacts = (text: string, kind?: 'CLIENT' | 'SUPPLIER' | 'BOTH') =>
  validateContactRows(parseCsv(text).records, kind);

describe('parseDecimal', () => {
  it.each([
    ['12', '12'],
    ['12.5', '12.5'],
    ['12,5', '12.5'],
    ['1 234,56', '1234.56'],
    ['1.234,56', '1234.56'],
    ['1,234.56', '1234.56'],
    ['1.234.567', '1234567'],
    ['89,90 MAD', '89.90'],
    ['20 %', '20'],
    ['-5', '-5'],
    ['.5', '0.5'],
  ])('%s -> %s', (input, expected) => {
    expect(parseDecimal(input)).toBe(expected);
  });

  it.each(['abc', '', '1.2.3x', '--1', '1,2,3'])('rejects %s', (input) => {
    expect(parseDecimal(input)).toBeNull();
  });
});

describe('value parsers', () => {
  it('booleans', () => {
    expect(parseBoolean('Oui')).toBe(true);
    expect(parseBoolean('NON')).toBe(false);
    expect(parseBoolean('maybe')).toBeNull();
  });
  it('contact kinds', () => {
    expect(parseContactKind('Fournisseur')).toBe('SUPPLIER');
    expect(parseContactKind('Client')).toBe('CLIENT');
    expect(parseContactKind('Client & fournisseur')).toBe('BOTH');
    expect(parseContactKind('???')).toBeNull();
  });
  it('payment terms', () => {
    expect(parsePaymentTerm('30 jours')).toBe('NET_30');
    expect(parsePaymentTerm('Net 60')).toBe('NET_60');
    expect(parsePaymentTerm('Comptant')).toBe('IMMEDIATE');
    expect(parsePaymentTerm('Fin de mois')).toBe('END_OF_MONTH');
    expect(parsePaymentTerm('37 jours')).toBeNull();
  });
});

describe('validateProductRows', () => {
  it('parses a valid FR row', () => {
    const { rows } = products(
      'Référence;Désignation;Prix de vente;TVA;Code-barres;Stock initial;Entrepôt\nA-1;Chaise;1 200,50;20;611;10;MAIN',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[0]!.row).toBe(2);
    expect(rows[0]!.parsed).toMatchObject({
      sku: 'A-1',
      name: 'Chaise',
      sellingPrice: '1200.50',
      vatRate: '20',
      barcode: '611',
      openingStock: '10',
      warehouse: 'MAIN',
    });
  });

  it('flags missing name and sku', () => {
    const { rows } = products('SKU,Name,Price\n,,5\nX,,5\n,N,5');
    expect(rows[0]!.errors).toEqual(['Name is required', 'SKU is required']);
    expect(rows[1]!.errors).toEqual(['Name is required']);
    expect(rows[2]!.errors).toEqual(['SKU is required']);
    expect(rows.every((r) => r.parsed === null)).toBe(true);
  });

  it('uses the barcode as SKU with a warning', () => {
    const { rows } = products('Name,Barcode\nThing,12345');
    expect(rows[0]!.parsed?.sku).toBe('12345');
    expect(rows[0]!.warnings[0]).toMatch(/barcode is used as SKU/);
  });

  it('validates numbers, negatives and VAT', () => {
    const { rows } = products('SKU,Name,Price,Cost,VAT,Weight,Service\na,A,x,-1,150,abc,maybe\nb,B,1,1,13,10,yes');
    expect(rows[0]!.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Selling price "x"/),
        expect.stringMatching(/Cost price must not be negative/),
        expect.stringMatching(/VAT must be between/),
        expect.stringMatching(/Weight/),
        expect.stringMatching(/Service/),
      ]),
    );
    expect(rows[1]!.errors).toEqual([]);
    expect(rows[1]!.warnings).toEqual(['Unusual VAT rate 13%']);
    expect(rows[1]!.parsed?.isService).toBe(true);
  });

  it('skips blank lines and trims values', () => {
    const { rows } = products('SKU,Name\n  a1  ,  Big   chair \n,\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.parsed).toMatchObject({ sku: 'a1', name: 'Big chair' });
  });

  it('reports line numbers across multi-line cells', () => {
    const { rows } = products('SKU,Name,Description\na,A,"l1\nl2"\nb,,');
    expect(rows.map((r) => r.row)).toEqual([2, 4]);
    expect(rows[0]!.parsed?.description).toBe('l1\nl2');
  });

  it('detects in-file duplicates by SKU and barcode', () => {
    const { rows } = products('SKU,Name,Barcode\na,A,1\nA,A2,2\nc,C,1');
    expect(rows[0]!.duplicateInFile).toBeNull();
    expect(rows[1]!.duplicateInFile).toMatchObject({ by: 'sku', row: 2 });
    expect(rows[2]!.duplicateInFile).toMatchObject({ by: 'barcode', row: 2 });
  });

  it('warns about extra cells', () => {
    const { rows } = products('SKU,Name\na,A,extra');
    expect(rows[0]!.warnings[0]).toMatch(/Extra values/);
  });

  it('keeps formulas as plain text', () => {
    const { rows } = products('SKU,Name\na,=cmd|calc');
    expect(rows[0]!.parsed?.name).toBe('=cmd|calc');
  });

  it('validates its own template', () => {
    for (const lang of ['fr', 'en'] as const) {
      const { rows, mapping } = products(productTemplate(lang));
      expect(mapping.missingRequired).toEqual([]);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.errors).toEqual([]);
    }
  });
});

describe('validateContactRows', () => {
  it('parses a Moroccan company row', () => {
    const { rows } = contacts(
      'Raison sociale;ICE;Type;Conditions de paiement;Plafond de crédit;E-mail\nAtlas SARL;001234567000012;fournisseur;30 jours;50 000;Contact@Atlas.ma',
    );
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[0]!.parsed).toMatchObject({
      displayName: 'Atlas SARL',
      ice: '001234567000012',
      kind: 'SUPPLIER',
      kindGiven: true,
      paymentTerm: 'NET_30',
      creditLimit: '50000',
      email: 'contact@atlas.ma',
    });
  });

  it('uses the default kind when no type column', () => {
    const { rows } = contacts('Name\nAcme', 'SUPPLIER');
    expect(rows[0]!.parsed).toMatchObject({ kind: 'SUPPLIER', kindGiven: false });
  });

  it('flags invalid fields', () => {
    const { rows } = contacts('Name,Email,Type,Payment terms,Currency,Credit limit\n,not-an-email,zzz,whenever,EURO,abc');
    expect(rows[0]!.errors).toHaveLength(6);
    expect(rows[0]!.parsed).toBeNull();
  });

  it('warns on an odd ICE', () => {
    const { rows } = contacts('Name,ICE\nA,123');
    expect(rows[0]!.warnings).toContain('ICE normally has 15 digits');
  });

  it('detects in-file duplicates by ICE, email and name', () => {
    const { rows } = contacts(
      'Name,ICE,Email\nAlpha,001 234 567 000 012,a@x.ma\nBeta,001234567000012,b@x.ma\nGamma,,A@X.ma\nalpha,,',
    );
    expect(rows[1]!.duplicateInFile).toMatchObject({ by: 'ice', row: 2 });
    expect(rows[2]!.duplicateInFile).toMatchObject({ by: 'email', row: 2 });
    expect(rows[3]!.duplicateInFile).toMatchObject({ by: 'name', row: 2 });
  });

  it('validates its own template', () => {
    for (const lang of ['fr', 'en'] as const) {
      const { rows, mapping } = contacts(contactTemplate(lang));
      expect(mapping.missingRequired).toEqual([]);
      for (const r of rows) expect(r.errors).toEqual([]);
    }
  });
});
