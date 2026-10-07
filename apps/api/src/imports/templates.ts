import { CONTACT_FIELDS, PRODUCT_FIELDS, type FieldDef } from './columns';
import { toCsv } from './csv';

const PRODUCT_EXAMPLES: Record<string, string>[] = [
  {
    sku: 'TSH-001',
    name: 'T-shirt coton',
    productCode: 'TSH',
    barcode: '6111000000011',
    description: 'T-shirt 100% coton',
    category: 'Vêtements',
    brand: 'Mizmar',
    unit: 'PCE',
    vatRate: '20',
    costPrice: '45',
    sellingPrice: '89,90',
    minStock: '5',
    weight: '180',
    isService: 'non',
    openingStock: '40',
    warehouse: 'MAIN',
  },
  {
    sku: 'SRV-LIV',
    name: 'Livraison',
    category: 'Services',
    vatRate: '20',
    sellingPrice: '30',
    isService: 'oui',
  },
];

const CONTACT_EXAMPLES: Record<string, string>[] = [
  {
    displayName: 'Atlas Distribution SARL',
    kind: 'client',
    code: 'CLI-001',
    ice: '001234567000012',
    rc: '123456',
    taxId: '40123456',
    patente: '31234567',
    email: 'compta@atlas.example',
    phone: '0522000000',
    paymentTerm: '30 jours',
    creditLimit: '50000',
    currency: 'MAD',
    vatExempt: 'non',
    address: '12 rue des Orangers',
    city: 'Casablanca',
    postalCode: '20000',
    country: 'MA',
  },
  {
    displayName: 'Fournitures du Nord',
    kind: 'fournisseur',
    email: 'contact@nord.example',
    phone: '0539000000',
    paymentTerm: 'comptant',
    city: 'Tanger',
    address: 'Zone industrielle',
  },
];

function build(defs: FieldDef[], examples: Record<string, string>[], lang: 'fr' | 'en'): string {
  const header = defs.map((d) => (lang === 'fr' ? d.fr : d.en));
  const rows = examples.map((example) => defs.map((d) => example[d.field] ?? ''));
  // BOM so Excel opens accents correctly; ';' because French-locale Excel expects it.
  return '﻿' + toCsv([header, ...rows], ';');
}

export function productTemplate(lang: 'fr' | 'en'): string {
  return build(PRODUCT_FIELDS, PRODUCT_EXAMPLES, lang);
}

export function contactTemplate(lang: 'fr' | 'en'): string {
  return build(CONTACT_FIELDS, CONTACT_EXAMPLES, lang);
}
