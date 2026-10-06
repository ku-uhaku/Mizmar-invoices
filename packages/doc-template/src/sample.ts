import type { RenderData, RenderLine } from './types';

/**
 * The document the configurator previews before a real one is chosen.
 *
 * Deliberately a Moroccan invoice with mixed VAT rates, a line discount, a
 * service line and a section heading, so every toggle in the style editor has
 * something to act on.
 */
export const SAMPLE_DOCUMENT: RenderData = {
  company: {
    name: 'Mizmar Trading',
    legalName: 'MIZMAR TRADING SARL',
    legalForm: 'SARL au capital de 500 000,00 DH',
    ice: '002345678000091',
    rc: '123456',
    taxId: '40123456',
    patente: '35678901',
    cnss: '8765432',
    shareCapital: '500000.00',
    email: 'contact@mizmar-trading.ma',
    phone: '+212 522 00 11 22',
    website: 'www.mizmar-trading.ma',
    address: {
      addressLine1: '12 Rue Ibn Batouta',
      addressLine2: 'Quartier Industriel',
      city: 'Casablanca',
      postalCode: '20300',
      country: 'MA',
    },
    bankName: 'Attijariwafa Bank',
    rib: '007 780 0001234567890123 45',
    iban: 'MA64007780000123456789012345',
    swift: 'BCMAMAMC',
    logoUrl: null,
    stampUrl: null,
    signatureUrl: null,
  },
  contact: {
    displayName: 'Atlas Distribution',
    legalName: 'ATLAS DISTRIBUTION SA',
    ice: '001122334400078',
    rc: '98765',
    taxId: '40998877',
    phone: '+212 522 55 66 77',
    billingAddress: {
      addressLine1: '8 Boulevard Zerktouni',
      city: 'Casablanca',
      postalCode: '20100',
      country: 'MA',
    },
    shippingAddress: {
      addressLine1: 'Plateforme logistique, Hall 3',
      city: 'Berrechid',
      postalCode: '26100',
      country: 'MA',
    },
  },
  document: {
    type: 'SALES_INVOICE',
    number: 'FA-2026-0042',
    issueDate: '2026-10-06',
    dueDate: '2026-11-05',
    reference: 'BL-2026-0118 / BL-2026-0121',
    projectName: 'Réassort automne',
    currency: 'MAD',
    notes: 'Marchandise vérifiée et acceptée à la livraison.',
    terms: null,
    paidAmount: '5000.00',
    outstandingAmount: '9622.00',
    lines: [
      {
        description: 'Textile — collection automne',
        quantity: '0',
        unitPrice: '0',
        lineDiscount: '0.00',
        vatRate: '0',
        vatAmount: '0.00',
        taxableBase: '0.00',
        lineTotal: '0.00',
        isNote: true,
      },
      {
        sku: 'POLO-ROU-L',
        barcode: '6100001234567',
        description: 'Polo Classique',
        variantLabel: 'Rouge / L',
        unitCode: 'U',
        quantity: '40.000000',
        unitPrice: '149.000000',
        discountKind: 'PERCENT',
        discountValue: '5',
        lineDiscount: '298.00',
        vatRate: '20.00',
        vatAmount: '1132.40',
        taxableBase: '5662.00',
        lineTotal: '6794.40',
        sourceReference: 'BL-2026-0118',
      },
      {
        sku: 'POLO-BLE-M',
        barcode: '6100001234574',
        description: 'Polo Classique',
        variantLabel: 'Bleu / M',
        unitCode: 'U',
        quantity: '25.000000',
        unitPrice: '149.000000',
        lineDiscount: '0.00',
        vatRate: '20.00',
        vatAmount: '745.00',
        taxableBase: '3725.00',
        lineTotal: '4470.00',
        sourceReference: 'BL-2026-0118',
      },
      {
        sku: 'CHEM-NOI-XL',
        description: 'Chemise Oxford',
        variantLabel: 'Noir / XL',
        unitCode: 'U',
        quantity: '12.000000',
        unitPrice: '249.000000',
        lineDiscount: '0.00',
        vatRate: '20.00',
        vatAmount: '597.60',
        taxableBase: '2988.00',
        lineTotal: '3585.60',
        sourceReference: 'BL-2026-0121',
      },
      {
        sku: 'LIV-PRO',
        description: 'Catalogue produit imprimé',
        unitCode: 'U',
        quantity: '100.000000',
        unitPrice: '12.000000',
        lineDiscount: '0.00',
        vatRate: '10.00',
        vatAmount: '120.00',
        taxableBase: '1200.00',
        lineTotal: '1320.00',
      },
      {
        sku: 'SRV-DELIV',
        description: 'Frais de livraison',
        unitCode: 'U',
        quantity: '1.000000',
        unitPrice: '150.000000',
        lineDiscount: '0.00',
        vatRate: '14.00',
        vatAmount: '21.00',
        taxableBase: '150.00',
        lineTotal: '171.00',
      },
    ],
    totals: {
      subtotalGross: '14023.00',
      totalLineDiscounts: '298.00',
      subtotalNet: '13725.00',
      globalDiscount: '0.00',
      shippingNet: '0.00',
      totalExclVat: '13725.00',
      totalVat: '2616.00',
      totalInclVat: '16341.00',
      vatBuckets: [
        { rate: '20.00', base: '12375.00', amount: '2475.00' },
        { rate: '14.00', base: '150.00', amount: '21.00' },
        { rate: '10.00', base: '1200.00', amount: '120.00' },
      ],
    },
  },
  warehouseName: 'Dépôt Casablanca',
  salespersonName: 'Salma Tazi',
};

/**
 * Pad the sample to a given number of lines, so the configurator can show what
 * the pagination rules actually do on a document that spans pages.
 */
export function sampleWithLineCount(lineCount: number): RenderData {
  const source = SAMPLE_DOCUMENT.document.lines.filter((line) => !line.isNote);
  const lines: RenderLine[] = [];

  for (let index = 0; index < lineCount; index += 1) {
    const template = source[index % source.length]!;
    lines.push({
      ...template,
      description: `${template.description} (${index + 1})`,
    });
  }

  return {
    ...SAMPLE_DOCUMENT,
    document: { ...SAMPLE_DOCUMENT.document, lines },
  };
}
