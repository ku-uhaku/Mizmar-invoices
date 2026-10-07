import { describe, expect, it } from 'vitest';
import { CONTACT_FIELDS, PRODUCT_FIELDS, mapHeaders, normalizeHeader } from './columns';
import { contactTemplate, productTemplate } from './templates';
import { parseCsv } from './csv';

describe('normalizeHeader', () => {
  it('strips accents, case and punctuation', () => {
    expect(normalizeHeader('  Désignation ')).toBe('designation');
    expect(normalizeHeader('Code-barres')).toBe('code barres');
    expect(normalizeHeader("Prix d'achat (HT)")).toBe('prix d achat ht');
  });
});

describe('mapHeaders (products)', () => {
  it('maps FR headers', () => {
    const m = mapHeaders(
      ['Référence', 'Désignation', 'Prix de vente', 'TVA', 'Code-barres', 'Marque', 'Stock initial'],
      PRODUCT_FIELDS,
    );
    expect(m.headers.map((h) => h.field)).toEqual([
      'sku',
      'name',
      'sellingPrice',
      'vatRate',
      'barcode',
      'brand',
      'openingStock',
    ]);
    expect(m.missingRequired).toEqual([]);
  });

  it('maps EN headers, case-insensitively', () => {
    const m = mapHeaders(['SKU', 'name', 'PRICE', 'vat', 'Barcode', 'cost'], PRODUCT_FIELDS);
    expect(m.headers.map((h) => h.field)).toEqual([
      'sku',
      'name',
      'sellingPrice',
      'vatRate',
      'barcode',
      'costPrice',
    ]);
  });

  it('reports unknown columns as null and missing required fields', () => {
    const m = mapHeaders(['Foo', 'Name'], PRODUCT_FIELDS);
    expect(m.headers[0]!.field).toBeNull();
    expect(m.missingRequired).toEqual(['sku']);
  });

  it('lets only the first column claim a field', () => {
    const m = mapHeaders(['SKU', 'Référence', 'Name'], PRODUCT_FIELDS);
    expect(m.headers.map((h) => h.field)).toEqual(['sku', null, 'name']);
    expect(m.index.get('sku')).toBe(0);
  });
});

describe('mapHeaders (contacts)', () => {
  it('maps Moroccan identity columns', () => {
    const m = mapHeaders(
      ['Raison sociale', 'ICE', 'RC', 'Identifiant fiscal', 'Patente', 'Téléphone', 'E-mail', 'Ville'],
      CONTACT_FIELDS,
    );
    expect(m.headers.map((h) => h.field)).toEqual([
      'displayName',
      'ice',
      'rc',
      'taxId',
      'patente',
      'phone',
      'email',
      'city',
    ]);
  });
});

describe('templates', () => {
  it('map back onto every field in both languages', () => {
    for (const lang of ['fr', 'en'] as const) {
      const p = parseCsv(productTemplate(lang));
      const pm = mapHeaders(p.records[0]!.cells, PRODUCT_FIELDS);
      expect(pm.headers.every((h) => h.field !== null)).toBe(true);
      expect(pm.index.size).toBe(PRODUCT_FIELDS.length);

      const c = parseCsv(contactTemplate(lang));
      const cm = mapHeaders(c.records[0]!.cells, CONTACT_FIELDS);
      expect(cm.index.size).toBe(CONTACT_FIELDS.length);
    }
  });
});
