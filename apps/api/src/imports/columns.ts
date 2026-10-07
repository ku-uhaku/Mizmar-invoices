/**
 * Column mapping: tolerant FR/EN header aliases -> canonical field names.
 */

export interface FieldDef<F extends string = string> {
  field: F;
  /** Canonical headers written to the templates. */
  fr: string;
  en: string;
  /** Extra accepted spellings (any case, accents or punctuation). */
  aliases: string[];
  required?: boolean;
}

/** Lowercase, strip accents, collapse every non-alphanumeric run to one space. */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface HeaderMapping<F extends string> {
  headers: { header: string; field: F | null }[];
  /** Canonical field -> column index. */
  index: Map<F, number>;
  missingRequired: F[];
}

export function mapHeaders<F extends string>(
  headerCells: string[],
  defs: FieldDef<F>[],
): HeaderMapping<F> {
  const lookup = new Map<string, F>();
  for (const def of defs) {
    for (const alias of [def.field, def.fr, def.en, ...def.aliases]) {
      lookup.set(normalizeHeader(alias), def.field);
    }
  }

  const index = new Map<F, number>();
  const headers = headerCells.map((raw, i) => {
    const header = raw.trim();
    const field = lookup.get(normalizeHeader(header)) ?? null;
    // The first column claiming a field wins; a repeated one is ignored.
    if (field && !index.has(field)) {
      index.set(field, i);
      return { header, field };
    }
    return { header, field: null };
  });

  const missingRequired = defs.filter((d) => d.required && !index.has(d.field)).map((d) => d.field);
  return { headers, index, missingRequired };
}

// ---------------------------------------------------------------------------
// Product columns
// ---------------------------------------------------------------------------

export type ProductField =
  | 'sku'
  | 'barcode'
  | 'name'
  | 'productCode'
  | 'description'
  | 'category'
  | 'brand'
  | 'unit'
  | 'vatRate'
  | 'costPrice'
  | 'sellingPrice'
  | 'minStock'
  | 'weight'
  | 'isService'
  | 'openingStock'
  | 'warehouse';

export const PRODUCT_FIELDS: FieldDef<ProductField>[] = [
  {
    field: 'sku',
    fr: 'Référence',
    en: 'SKU',
    aliases: ['ref', 'code article', 'item code', 'article code', 'reference sku', 'code'],
    required: true,
  },
  {
    field: 'name',
    fr: 'Désignation',
    en: 'Name',
    aliases: ['libelle', 'nom', 'nom du produit', 'product name', 'produit', 'product', 'article'],
    required: true,
  },
  {
    field: 'productCode',
    fr: 'Code produit',
    en: 'Product code',
    aliases: ['groupe', 'product group', 'group', 'product reference', 'reference produit'],
  },
  { field: 'barcode', fr: 'Code-barres', en: 'Barcode', aliases: ['code barre', 'ean', 'gtin', 'upc', 'ean13'] },
  { field: 'description', fr: 'Description', en: 'Description', aliases: ['desc', 'details'] },
  { field: 'category', fr: 'Catégorie', en: 'Category', aliases: ['famille', 'family', 'categorie'] },
  { field: 'brand', fr: 'Marque', en: 'Brand', aliases: ['fabricant', 'manufacturer'] },
  { field: 'unit', fr: 'Unité', en: 'Unit', aliases: ['uom', 'unite de mesure', 'unit code'] },
  {
    field: 'vatRate',
    fr: 'TVA',
    en: 'VAT',
    aliases: ['taux tva', 'taux de tva', 'vat rate', 'tax', 'tva %', 'vat %'],
  },
  {
    field: 'costPrice',
    fr: "Prix d'achat",
    en: 'Cost',
    aliases: ['prix achat', 'pa', 'cout', 'cout achat', 'cost price', 'purchase price', 'pa ht'],
  },
  {
    field: 'sellingPrice',
    fr: 'Prix de vente',
    en: 'Price',
    aliases: [
      'prix vente',
      'pv',
      'prix',
      'selling price',
      'sale price',
      'unit price',
      'prix ht',
      'prix de vente ht',
      'pv ht',
    ],
  },
  {
    field: 'minStock',
    fr: 'Stock minimum',
    en: 'Min stock',
    aliases: ['stock min', 'seuil', "seuil d alerte", 'seuil alerte', 'min stock threshold', 'reorder level'],
  },
  { field: 'weight', fr: 'Poids (g)', en: 'Weight (g)', aliases: ['poids', 'weight', 'weight g', 'poids g', 'grammes'] },
  { field: 'isService', fr: 'Service', en: 'Service', aliases: ['est un service', 'is service', 'type service'] },
  {
    field: 'openingStock',
    fr: 'Stock initial',
    en: 'Opening stock',
    aliases: ['stock', 'quantite', 'qte', 'qty', 'quantity', 'stock d ouverture', 'stock ouverture'],
  },
  {
    field: 'warehouse',
    fr: 'Entrepôt',
    en: 'Warehouse',
    aliases: ['depot', 'entrepot', 'magasin', 'warehouse code', 'code entrepot'],
  },
];

// ---------------------------------------------------------------------------
// Contact columns
// ---------------------------------------------------------------------------

export type ContactField =
  | 'kind'
  | 'code'
  | 'displayName'
  | 'legalName'
  | 'ice'
  | 'rc'
  | 'taxId'
  | 'patente'
  | 'email'
  | 'phone'
  | 'phone2'
  | 'website'
  | 'paymentTerm'
  | 'paymentTermDays'
  | 'creditLimit'
  | 'currency'
  | 'vatExempt'
  | 'notes'
  | 'address'
  | 'city'
  | 'postalCode'
  | 'country';

export const CONTACT_FIELDS: FieldDef<ContactField>[] = [
  {
    field: 'displayName',
    fr: 'Raison sociale',
    en: 'Name',
    aliases: ['nom', 'display name', 'societe', 'company', 'nom commercial', 'client', 'fournisseur', 'tiers', 'denomination commerciale'],
    required: true,
  },
  { field: 'kind', fr: 'Type', en: 'Type', aliases: ['kind', 'nature', 'type de tiers', 'client fournisseur'] },
  { field: 'code', fr: 'Code', en: 'Code', aliases: ['code client', 'code tiers', 'customer code', 'ref', 'reference'] },
  { field: 'legalName', fr: 'Dénomination légale', en: 'Legal name', aliases: ['denomination', 'nom legal', 'forme juridique'] },
  { field: 'ice', fr: 'ICE', en: 'ICE', aliases: ['n ice', 'numero ice', 'ice number'] },
  { field: 'rc', fr: 'RC', en: 'RC', aliases: ['registre de commerce', 'n rc', 'trade register'] },
  {
    field: 'taxId',
    fr: 'IF',
    en: 'Tax ID',
    aliases: ['identifiant fiscal', 'id fiscal', 'tax id', 'tax number', 'n if', 'if'],
  },
  { field: 'patente', fr: 'Patente', en: 'Patente', aliases: ['taxe professionnelle', 'tp', 'n patente'] },
  { field: 'email', fr: 'E-mail', en: 'Email', aliases: ['mail', 'courriel', 'adresse email', 'e mail'] },
  { field: 'phone', fr: 'Téléphone', en: 'Phone', aliases: ['tel', 'telephone', 'mobile', 'gsm', 'phone 1', 'tel 1'] },
  { field: 'phone2', fr: 'Téléphone 2', en: 'Phone 2', aliases: ['tel 2', 'telephone 2', 'fixe'] },
  { field: 'website', fr: 'Site web', en: 'Website', aliases: ['site', 'url', 'web'] },
  {
    field: 'paymentTerm',
    fr: 'Conditions de paiement',
    en: 'Payment terms',
    aliases: ['payment term', 'conditions', 'delai de paiement', 'echeance', 'terms'],
  },
  { field: 'paymentTermDays', fr: 'Délai (jours)', en: 'Payment days', aliases: ['delai jours', 'jours', 'payment term days', 'nb jours'] },
  { field: 'creditLimit', fr: 'Plafond de crédit', en: 'Credit limit', aliases: ['plafond', 'encours max', 'encours maximum', 'limite de credit'] },
  { field: 'currency', fr: 'Devise', en: 'Currency', aliases: ['monnaie', 'default currency'] },
  { field: 'vatExempt', fr: 'Exonéré TVA', en: 'VAT exempt', aliases: ['exonere', 'exoneration tva', 'exonere de tva', 'vat exemption'] },
  { field: 'notes', fr: 'Notes', en: 'Notes', aliases: ['note', 'remarques', 'commentaire', 'comment', 'observations'] },
  { field: 'address', fr: 'Adresse', en: 'Address', aliases: ['adresse facturation', 'rue', 'street', 'address line 1', 'adresse 1'] },
  { field: 'city', fr: 'Ville', en: 'City', aliases: ['commune'] },
  { field: 'postalCode', fr: 'Code postal', en: 'Postal code', aliases: ['cp', 'zip', 'zip code', 'postcode'] },
  { field: 'country', fr: 'Pays', en: 'Country', aliases: ['country code', 'code pays'] },
];
