/**
 * Demo dataset.
 *
 * Builds the world the manual verification script in the plan walks through:
 * two legal entities in one organization, two warehouses, a phone-store
 * catalogue (smartphones, accessories, repair services), clients, suppliers and
 * one user per role. Idempotent — safe to run
 * repeatedly against the same database.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';

const prisma = new PrismaClient();
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const d = (value: string | number) => new Prisma.Decimal(value);

async function hashPassword(password: string): Promise<string> {
  const params = { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, 32, params);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), derived.toString('base64')].join('$');
}

const MOROCCAN_VAT = [
  { rate: 20, label: 'TVA 20%', isDefault: true },
  { rate: 14, label: 'TVA 14%', isDefault: false },
  { rate: 10, label: 'TVA 10%', isDefault: false },
  { rate: 7, label: 'TVA 7%', isDefault: false },
  { rate: 0, label: 'Exonéré', isDefault: false },
];

async function main(): Promise<void> {
  console.log('Seeding Mizmar demo data...');

  const organization = await prisma.organization.upsert({
    where: { slug: 'mizmar' },
    update: {},
    create: { name: 'Mizmar Group', slug: 'mizmar' },
  });

  // ---- Units -------------------------------------------------------------
  const units = await Promise.all(
    [
      { code: 'U', name: 'Unité' },
      { code: 'M', name: 'Mètre' },
      { code: 'KG', name: 'Kilogramme' },
      { code: 'BOX', name: 'Carton' },
    ].map((unit) =>
      prisma.unit.upsert({
        where: { organizationId_code: { organizationId: organization.id, code: unit.code } },
        update: {},
        create: { ...unit, organizationId: organization.id },
      }),
    ),
  );
  const unitPiece = units[0]!;

  // ---- Warehouses --------------------------------------------------------
  const [warehouseA, warehouseB] = await Promise.all(
    [
      { code: 'WH-CASA', name: 'Dépôt Casablanca', city: 'Casablanca' },
      { code: 'WH-RABAT', name: 'Dépôt Rabat', city: 'Rabat' },
    ].map((warehouse) =>
      prisma.warehouse.upsert({
        where: {
          organizationId_code: { organizationId: organization.id, code: warehouse.code },
        },
        update: {},
        create: { ...warehouse, organizationId: organization.id },
      }),
    ),
  );

  // ---- Companies (two legal entities sharing one catalog) ----------------
  const companyTrade = await prisma.company.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: 'MZT' } },
    update: {},
    create: {
      organizationId: organization.id,
      code: 'MZT',
      name: 'Mizmar Trading',
      legalName: 'MIZMAR TRADING SARL',
      legalForm: 'SARL',
      ice: '002345678000091',
      rc: '123456',
      taxId: '40123456',
      patente: '35678901',
      cnss: '8765432',
      shareCapital: d('500000.00'),
      email: 'contact@mizmar-trading.ma',
      phone: '+212 522 00 11 22',
      addressLine1: '12 Rue Ibn Batouta',
      addressLine2: 'Quartier Industriel',
      city: 'Casablanca',
      postalCode: '20300',
      country: 'MA',
      bankName: 'Attijariwafa Bank',
      rib: '007 780 0001234567890123 45',
      iban: 'MA64007780000123456789012345',
      swift: 'BCMAMAMC',
      defaultCurrency: 'MAD',
      defaultLocale: 'FR',
      defaultWarehouseId: warehouseA.id,
      negativeStockPolicy: 'BLOCK',
    },
  });

  const companyRetail = await prisma.company.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: 'MZR' } },
    update: {},
    create: {
      organizationId: organization.id,
      code: 'MZR',
      name: 'Mizmar Retail',
      legalName: 'MIZMAR RETAIL SARL AU',
      legalForm: 'SARL AU',
      ice: '002345678000092',
      rc: '654321',
      taxId: '40654321',
      shareCapital: d('100000.00'),
      email: 'contact@mizmar-retail.ma',
      phone: '+212 537 00 33 44',
      addressLine1: '45 Avenue Mohammed V',
      city: 'Rabat',
      postalCode: '10000',
      country: 'MA',
      defaultCurrency: 'MAD',
      defaultLocale: 'FR',
      defaultWarehouseId: warehouseB.id,
      // A retail counter cannot refuse a sale because the system disagrees, so
      // this entity warns instead of blocking.
      negativeStockPolicy: 'WARN',
    },
  });

  for (const company of [companyTrade, companyRetail]) {
    for (const [index, vat] of MOROCCAN_VAT.entries()) {
      await prisma.vatRate.upsert({
        where: { companyId_rate: { companyId: company.id, rate: d(vat.rate) } },
        update: {},
        create: {
          companyId: company.id,
          rate: d(vat.rate),
          label: vat.label,
          isDefault: vat.isDefault,
          sortOrder: index,
        },
      });
    }
  }

  // ---- Users, one per role ----------------------------------------------
  const password = await hashPassword('Mizmar2026!');
  const people = [
    { email: 'owner@mizmar.ma', username: 'owner', fullName: 'Amina Benali', role: 'OWNER' as const },
    { email: 'accountant@mizmar.ma', username: 'accountant', fullName: 'Youssef Idrissi', role: 'ACCOUNTANT' as const },
    { email: 'sales@mizmar.ma', username: 'sales', fullName: 'Salma Tazi', role: 'SALES' as const },
    { email: 'warehouse@mizmar.ma', username: 'warehouse', fullName: 'Karim Ouazzani', role: 'WAREHOUSE' as const },
  ];

  for (const person of people) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: { username: person.username },
      create: {
        email: person.email,
        username: person.username,
        fullName: person.fullName,
        passwordHash: password,
        locale: 'FR',
      },
    });

    const membership = await prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
      update: { role: person.role },
      create: { userId: user.id, organizationId: organization.id, role: person.role },
    });

    // Owners reach every company implicitly; everyone else needs a grant.
    for (const company of [companyTrade, companyRetail]) {
      await prisma.companyAccess.upsert({
        where: {
          membershipId_companyId: { membershipId: membership.id, companyId: company.id },
        },
        update: {},
        create: { membershipId: membership.id, companyId: company.id },
      });
    }
  }

  // ---- Phone store catalogue --------------------------------------------
  await seedPhoneStore(organization.id, unitPiece.id, [warehouseA, warehouseB]);

  // ---- Contacts ----------------------------------------------------------
  const contacts = [
    {
      code: 'CL-001',
      kind: 'CLIENT' as const,
      displayName: 'Atlas Distribution',
      legalName: 'ATLAS DISTRIBUTION SA',
      ice: '001122334400078',
      rc: '98765',
      taxId: '40998877',
      email: 'achats@atlas-dist.ma',
      phone: '+212 522 55 66 77',
      paymentTerm: 'NET_30' as const,
      creditLimit: d('200000.00'),
      city: 'Casablanca',
      address: '8 Boulevard Zerktouni',
    },
    {
      code: 'CL-002',
      kind: 'CLIENT' as const,
      displayName: 'Boutique Medina',
      legalName: 'BOUTIQUE MEDINA SARL',
      ice: '001122334400079',
      email: 'contact@medina.ma',
      phone: '+212 524 11 22 33',
      paymentTerm: 'IMMEDIATE' as const,
      creditLimit: null,
      city: 'Marrakech',
      address: '22 Rue Riad Zitoun',
    },
    {
      code: 'FR-001',
      kind: 'SUPPLIER' as const,
      displayName: 'Mobile Import Co',
      legalName: 'MOBILE IMPORT CO SARL',
      ice: '005566778800012',
      email: 'sales@mobile-import.ma',
      phone: '+212 522 99 88 77',
      paymentTerm: 'NET_45' as const,
      creditLimit: null,
      city: 'Tanger',
      address: 'Zone Franche, Lot 44',
    },
    {
      code: 'CL-003',
      kind: 'BOTH' as const,
      displayName: 'Souss Trading',
      legalName: 'SOUSS TRADING SARL',
      ice: '009988776600034',
      email: 'info@souss-trading.ma',
      phone: '+212 528 44 55 66',
      paymentTerm: 'NET_60' as const,
      creditLimit: d('80000.00'),
      city: 'Agadir',
      address: '5 Avenue Hassan II',
    },
  ];

  for (const contact of contacts) {
    const existing = await prisma.contact.findFirst({
      where: { organizationId: organization.id, code: contact.code },
    });
    if (existing) continue;

    await prisma.contact.create({
      data: {
        organizationId: organization.id,
        code: contact.code,
        kind: contact.kind,
        displayName: contact.displayName,
        legalName: contact.legalName,
        ice: contact.ice,
        rc: 'rc' in contact ? (contact.rc as string | undefined) ?? null : null,
        taxId: 'taxId' in contact ? (contact.taxId as string | undefined) ?? null : null,
        email: contact.email,
        phone: contact.phone,
        paymentTerm: contact.paymentTerm,
        creditLimit: contact.creditLimit,
        defaultCurrency: 'MAD',
        addresses: {
          create: [
            {
              kind: 'BILLING',
              addressLine1: contact.address,
              city: contact.city,
              country: 'MA',
              isDefault: true,
            },
          ],
        },
      },
    });
  }

  console.log('Seed complete.');
  console.log('  Organization : Mizmar Group');
  console.log('  Companies    : MZT (Mizmar Trading), MZR (Mizmar Retail)');
  console.log('  Warehouses   : WH-CASA, WH-RABAT');
  console.log('  Sign in      : owner@mizmar.ma (or username "owner") / Mizmar2026!');
  console.log('                 accountant@mizmar.ma, sales@mizmar.ma, warehouse@mizmar.ma');
}

async function upsertAttribute(
  organizationId: string,
  code: string,
  name: string,
  sortOrder: number,
  values: Array<{ value: string; colorHex?: string }>,
) {
  const attribute = await prisma.attributeType.upsert({
    where: { organizationId_code: { organizationId, code } },
    update: {},
    create: { organizationId, code, name, sortOrder },
  });

  const stored = [];
  for (const [index, value] of values.entries()) {
    stored.push(
      await prisma.attributeValue.upsert({
        where: {
          attributeTypeId_value: { attributeTypeId: attribute.id, value: value.value },
        },
        update: {},
        create: {
          attributeTypeId: attribute.id,
          value: value.value,
          colorHex: value.colorHex ?? null,
          sortOrder: index,
        },
      }),
    );
  }

  return { ...attribute, values: stored };
}

// ---------------------------------------------------------------------------
// Phone store catalogue
// ---------------------------------------------------------------------------

const COLOURS = [
  { value: 'Noir', colorHex: '#111827' },
  { value: 'Blanc', colorHex: '#F9FAFB' },
  { value: 'Gris', colorHex: '#6B7280' },
  { value: 'Argent', colorHex: '#D1D5DB' },
  { value: 'Titane', colorHex: '#A8A29E' },
  { value: 'Or', colorHex: '#D4A84B' },
  { value: 'Bleu', colorHex: '#2563EB' },
  { value: 'Vert', colorHex: '#16A34A' },
  { value: 'Rouge', colorHex: '#DC2626' },
  { value: 'Rose', colorHex: '#F472B6' },
  { value: 'Violet', colorHex: '#7C3AED' },
  { value: 'Crème', colorHex: '#F5E6C8' },
];

const STORAGES = ['64 Go', '128 Go', '256 Go', '512 Go', '1 To'].map((value) => ({ value }));

type VariantSpec = { colour?: string; storage?: string; price: number };

type ProductSpec = {
  reference: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  /** Cost as a fraction of the selling price; phones carry thin margins. */
  costRatio: number;
  minStock: number;
  weightGrams?: number;
  /** Opening stock for the main warehouse; the second gets about 40% of it. */
  stock: number;
  isService?: boolean;
  variants: VariantSpec[];
};

/** Storage tiers x colours, each tier carrying its own price. */
function grid(tiers: Array<[string, number]>, colours: string[]): VariantSpec[] {
  return tiers.flatMap(([storage, price]) => colours.map((colour) => ({ colour, storage, price })));
}

function colours(price: number, names: string[]): VariantSpec[] {
  return names.map((colour) => ({ colour, price }));
}

const PHONE = { category: 'Smartphones', costRatio: 0.87, minStock: 3, weightGrams: 200, stock: 8 };
const ACC = { costRatio: 0.55, minStock: 10, stock: 30 };

const PHONE_CATALOG: ProductSpec[] = [
  // ---- Apple ----
  {
    ...PHONE, reference: 'IP16PRO', name: 'iPhone 16 Pro', brand: 'Apple',
    description: 'Écran Super Retina XDR 6,3", puce A18 Pro, triple capteur 48 Mpx, 5G.',
    variants: grid([['256 Go', 14990], ['512 Go', 17990], ['1 To', 20990]], ['Noir', 'Blanc', 'Titane', 'Or']),
  },
  {
    ...PHONE, reference: 'IP16', name: 'iPhone 16', brand: 'Apple',
    description: 'Écran Super Retina XDR 6,1", puce A18, double capteur 48 Mpx, 5G.',
    variants: grid([['128 Go', 10990], ['256 Go', 12490], ['512 Go', 15490]], ['Noir', 'Blanc', 'Rose', 'Vert', 'Bleu']),
  },
  {
    ...PHONE, reference: 'IP15', name: 'iPhone 15', brand: 'Apple',
    description: 'Écran Super Retina XDR 6,1", puce A16 Bionic, USB-C, 5G.',
    variants: grid([['128 Go', 8990], ['256 Go', 10290]], ['Noir', 'Bleu', 'Rose']),
  },
  // ---- Samsung ----
  {
    ...PHONE, reference: 'GS25U', name: 'Galaxy S25 Ultra', brand: 'Samsung',
    description: 'Dynamic AMOLED 6,9", Snapdragon 8 Elite, S Pen, quadruple capteur 200 Mpx.',
    variants: grid([['256 Go', 14490], ['512 Go', 16490], ['1 To', 19490]], ['Noir', 'Gris', 'Bleu', 'Argent']),
  },
  {
    ...PHONE, reference: 'GS25', name: 'Galaxy S25', brand: 'Samsung',
    description: 'Dynamic AMOLED 6,2", Snapdragon 8 Elite, triple capteur 50 Mpx, 5G.',
    variants: grid([['128 Go', 9990], ['256 Go', 10990]], ['Noir', 'Bleu', 'Violet', 'Vert']),
  },
  {
    ...PHONE, reference: 'GA55', name: 'Galaxy A55 5G', brand: 'Samsung',
    description: 'Super AMOLED 6,6" 120 Hz, Exynos 1480, batterie 5000 mAh.',
    stock: 14, variants: grid([['128 Go', 4590], ['256 Go', 5190]], ['Noir', 'Bleu', 'Violet']),
  },
  {
    ...PHONE, reference: 'GA15', name: 'Galaxy A15', brand: 'Samsung',
    description: 'Super AMOLED 6,5", triple capteur 50 Mpx, batterie 5000 mAh.',
    stock: 20, variants: grid([['128 Go', 1990], ['256 Go', 2290]], ['Noir', 'Bleu', 'Vert']),
  },
  // ---- Xiaomi ----
  {
    ...PHONE, reference: 'XRN13P', name: 'Redmi Note 13 Pro', brand: 'Xiaomi',
    description: 'AMOLED 6,67" 120 Hz, capteur 200 Mpx, charge 67 W.',
    stock: 16, variants: grid([['128 Go', 3290], ['256 Go', 3790]], ['Noir', 'Bleu', 'Violet']),
  },
  {
    ...PHONE, reference: 'X14T', name: 'Xiaomi 14T', brand: 'Xiaomi',
    description: 'AMOLED 6,67" 144 Hz, optique Leica, charge 67 W.',
    variants: grid([['256 Go', 6490], ['512 Go', 7290]], ['Noir', 'Bleu', 'Gris']),
  },
  {
    ...PHONE, reference: 'XR13C', name: 'Redmi 13C', brand: 'Xiaomi',
    description: 'LCD 6,74" 90 Hz, capteur 50 Mpx, batterie 5000 mAh.',
    stock: 24, variants: grid([['128 Go', 1290]], ['Noir', 'Bleu', 'Vert']),
  },
  // ---- Others ----
  {
    ...PHONE, reference: 'PX9', name: 'Pixel 9', brand: 'Google',
    description: 'OLED 6,3" 120 Hz, puce Tensor G4, 7 ans de mises à jour.',
    variants: grid([['128 Go', 8990], ['256 Go', 9990]], ['Noir', 'Blanc', 'Vert', 'Rose']),
  },
  {
    ...PHONE, reference: 'HN200', name: 'Honor 200', brand: 'Honor',
    description: 'OLED incurvé 6,7", portrait studio 50 Mpx, charge 100 W.',
    variants: grid([['256 Go', 4290], ['512 Go', 4890]], ['Noir', 'Vert']),
  },
  {
    ...PHONE, reference: 'OR12', name: 'Reno 12', brand: 'Oppo',
    description: 'AMOLED 6,7" 120 Hz, triple capteur 50 Mpx, charge 80 W.',
    variants: grid([['256 Go', 4990]], ['Gris', 'Violet']),
  },
  {
    ...PHONE, reference: 'TS20', name: 'Spark 20', brand: 'Tecno',
    description: 'LCD 6,56" 90 Hz, capteur 50 Mpx, batterie 5000 mAh.',
    stock: 20, variants: grid([['128 Go', 1490]], ['Noir', 'Bleu']),
  },
  {
    ...PHONE, reference: 'NK110', name: 'Nokia 110 4G', brand: 'Nokia',
    category: 'Téléphones basiques', description: 'Téléphone à touches 4G, double SIM, radio FM.',
    costRatio: 0.78, minStock: 5, weightGrams: 90, stock: 25, variants: colours(349, ['Noir', 'Bleu']),
  },

  // ---- Protection ----
  {
    ...ACC, reference: 'CASE-IP16', name: 'Coque silicone iPhone 16', brand: 'Apple', category: 'Coques & protections',
    description: 'Coque silicone avec MagSafe, intérieur microfibre.', weightGrams: 40,
    costRatio: 0.6, variants: colours(499, ['Noir', 'Bleu', 'Rouge', 'Rose']),
  },
  {
    ...ACC, reference: 'CASE-S25', name: 'Coque transparente Galaxy S25', brand: 'Samsung', category: 'Coques & protections',
    description: 'Coque rigide transparente, bords renforcés.', weightGrams: 35, variants: [{ price: 199 }],
  },
  {
    ...ACC, reference: 'GLASS-IP16', name: 'Verre trempé iPhone 16', brand: 'Mizmar', category: 'Coques & protections',
    description: 'Verre trempé 9H, bords 2,5D, kit de pose inclus.', weightGrams: 20,
    costRatio: 0.25, stock: 60, variants: [{ price: 79 }],
  },
  {
    ...ACC, reference: 'GLASS-S25', name: 'Verre trempé Galaxy S25', brand: 'Mizmar', category: 'Coques & protections',
    description: 'Verre trempé 9H compatible capteur d’empreinte.', weightGrams: 20,
    costRatio: 0.25, stock: 60, variants: [{ price: 79 }],
  },

  // ---- Chargeurs & câbles ----
  {
    ...ACC, reference: 'CHG-AP20', name: 'Chargeur USB-C 20 W', brand: 'Apple', category: 'Chargeurs & câbles',
    description: 'Adaptateur secteur USB-C, charge rapide.', weightGrams: 60,
    costRatio: 0.72, variants: [{ price: 249 }],
  },
  {
    ...ACC, reference: 'CHG-SS25', name: 'Chargeur rapide 25 W', brand: 'Samsung', category: 'Chargeurs & câbles',
    description: 'Adaptateur USB-C Super Fast Charging 25 W.', weightGrams: 65,
    variants: colours(249, ['Noir', 'Blanc']),
  },
  {
    ...ACC, reference: 'CHG-ANK65', name: 'Chargeur GaN 65 W', brand: 'Anker', category: 'Chargeurs & câbles',
    description: 'Chargeur 3 ports USB-C/USB-A, compatible laptop.', weightGrams: 140,
    variants: [{ price: 449 }],
  },
  {
    ...ACC, reference: 'CAB-CC', name: 'Câble USB-C vers USB-C 1 m', brand: 'Anker', category: 'Chargeurs & câbles',
    description: 'Câble tressé 60 W, USB 2.0.', weightGrams: 30, costRatio: 0.4, stock: 50,
    variants: colours(99, ['Noir', 'Blanc']),
  },
  {
    ...ACC, reference: 'CAB-LTN', name: 'Câble USB-C vers Lightning 1 m', brand: 'Apple', category: 'Chargeurs & câbles',
    description: 'Câble officiel certifié MFi.', weightGrams: 30, costRatio: 0.7, variants: [{ price: 179 }],
  },
  {
    ...ACC, reference: 'MAGSAFE', name: 'Chargeur sans fil MagSafe', brand: 'Apple', category: 'Chargeurs & câbles',
    description: 'Charge sans fil magnétique 15 W.', weightGrams: 50, costRatio: 0.75, variants: [{ price: 429 }],
  },
  {
    ...ACC, reference: 'PB-ANK20', name: 'Batterie externe 20 000 mAh', brand: 'Anker', category: 'Batteries externes',
    description: 'Power bank 22,5 W, double sortie USB-C.', weightGrams: 350,
    variants: colours(449, ['Noir', 'Bleu']),
  },
  {
    ...ACC, reference: 'PB-XM10', name: 'Batterie externe 10 000 mAh', brand: 'Xiaomi', category: 'Batteries externes',
    description: 'Power bank slim 22,5 W.', weightGrams: 220, variants: colours(299, ['Noir', 'Blanc']),
  },

  // ---- Audio & objets connectés ----
  {
    ...ACC, reference: 'APP2', name: 'AirPods Pro 2', brand: 'Apple', category: 'Audio',
    description: 'Réduction de bruit active, boîtier USB-C MagSafe.', weightGrams: 50,
    costRatio: 0.82, minStock: 4, stock: 10, variants: [{ price: 2990 }],
  },
  {
    ...ACC, reference: 'AP4', name: 'AirPods 4', brand: 'Apple', category: 'Audio',
    description: 'Écouteurs sans fil, puce H2, boîtier USB-C.', weightGrams: 45,
    costRatio: 0.82, minStock: 4, stock: 10, variants: [{ price: 1790 }],
  },
  {
    ...ACC, reference: 'BUDS3P', name: 'Galaxy Buds3 Pro', brand: 'Samsung', category: 'Audio',
    description: 'Réduction de bruit adaptative, audio 24 bits.', weightGrams: 50,
    costRatio: 0.8, minStock: 4, stock: 10, variants: colours(2690, ['Blanc', 'Argent']),
  },
  {
    ...ACC, reference: 'RBUDS6', name: 'Redmi Buds 6 Active', brand: 'Xiaomi', category: 'Audio',
    description: 'Écouteurs Bluetooth 5.4, 30 h d’autonomie.', weightGrams: 40, variants: [{ price: 299 }],
  },
  {
    ...ACC, reference: 'JBL-GO4', name: 'Enceinte Go 4', brand: 'JBL', category: 'Audio',
    description: 'Enceinte Bluetooth portable étanche IP67.', weightGrams: 190,
    costRatio: 0.7, stock: 12, variants: colours(549, ['Noir', 'Bleu', 'Rouge']),
  },
  {
    ...ACC, reference: 'MI-BAND9', name: 'Smart Band 9', brand: 'Xiaomi', category: 'Objets connectés',
    description: 'Bracelet connecté AMOLED 1,62", 21 jours d’autonomie.', weightGrams: 25,
    costRatio: 0.75, stock: 12, variants: colours(499, ['Noir', 'Rose']),
  },

  // ---- Storage & misc ----
  {
    ...ACC, reference: 'SD-MICRO', name: 'Carte microSD Ultra', brand: 'SanDisk', category: 'Stockage',
    description: 'Carte microSDXC A1, 120 Mo/s.', weightGrams: 5, costRatio: 0.7, stock: 40,
    variants: [{ storage: '64 Go', price: 99 }, { storage: '128 Go', price: 169 }, { storage: '256 Go', price: 299 }],
  },
  {
    ...ACC, reference: 'CAR-MNT', name: 'Support voiture magnétique', brand: 'Mizmar', category: 'Accessoires',
    description: 'Support magnétique pour grille d’aération.', weightGrams: 80,
    costRatio: 0.35, variants: [{ price: 119 }],
  },

  // ---- Services ----
  { ...SERVICE('SRV-SCREEN', 'Réparation écran', 'Remplacement d’écran, pièce non incluse.', 300) },
  { ...SERVICE('SRV-BATT', 'Remplacement batterie', 'Batterie neuve et pose, garantie 6 mois.', 250) },
  { ...SERVICE('SRV-DATA', 'Transfert de données', 'Transfert contacts, photos et applications.', 50) },
  { ...SERVICE('SRV-FILM', 'Pose film protecteur', 'Pose d’un film ou verre trempé en boutique.', 30) },
  { ...SERVICE('SRV-DELIV', 'Frais de livraison', 'Livraison à domicile.', 150) },
];

function SERVICE(reference: string, name: string, description: string, price: number): ProductSpec {
  return {
    reference, name, description, brand: '', category: 'Services', costRatio: 0, minStock: 0, stock: 0,
    isService: true, variants: [{ price }],
  };
}

/**
 * Creates the phone-store catalogue. Idempotent per product reference, so a
 * re-run only adds what is missing. Opening stock goes through the ledger like
 * every other movement, so day-one quantities are auditable.
 */
async function seedPhoneStore(
  organizationId: string,
  unitId: string,
  warehouses: Array<{ id: string }>,
): Promise<void> {
  const colour = await upsertAttribute(organizationId, 'COLOR', 'Couleur', 0, COLOURS);
  const storage = await upsertAttribute(organizationId, 'STORAGE', 'Stockage', 1, STORAGES);
  const valueOf = (type: typeof colour, value: string) => {
    const found = type.values.find((candidate) => candidate.value === value);
    if (!found) throw new Error(`Unknown ${type.code} value "${value}"`);
    return found;
  };

  let created = 0;
  let variantCount = 0;

  for (const spec of PHONE_CATALOG) {
    const existing = await prisma.product.findFirst({
      where: { organizationId, reference: spec.reference },
    });
    if (existing) continue;

    const usesColour = spec.variants.some((variant) => variant.colour);
    const usesStorage = spec.variants.some((variant) => variant.storage);
    const dimensions = [usesColour && colour, usesStorage && storage].filter(
      (type): type is typeof colour => Boolean(type),
    );

    const product = await prisma.product.create({
      data: {
        organizationId,
        name: spec.name,
        reference: spec.reference,
        description: spec.description,
        category: spec.category,
        brand: spec.brand || null,
        unitId,
        defaultVatRate: d(20),
        isVariantManaged: dimensions.length > 0,
        isService: spec.isService ?? false,
        attributes: {
          create: dimensions.map((type, index) => ({ attributeTypeId: type.id, sortOrder: index })),
        },
      },
    });
    created += 1;

    for (const variantSpec of spec.variants) {
      const values = [
        variantSpec.colour ? valueOf(colour, variantSpec.colour) : null,
        variantSpec.storage ? valueOf(storage, variantSpec.storage) : null,
      ].filter((value) => value !== null);
      // Storage reads first on a phone ("256 Go / Noir"), the reverse of the attribute order.
      const label = [variantSpec.storage, variantSpec.colour].filter(Boolean).join(' / ');
      const sku = [
        spec.reference,
        ...(variantSpec.colour ? [skuToken(variantSpec.colour)] : []),
        ...(variantSpec.storage ? [skuToken(variantSpec.storage)] : []),
      ].join('-');
      const cost = (variantSpec.price * spec.costRatio).toFixed(2);

      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku,
          barcode: spec.isService ? null : `611${hash6(sku)}${hash6(spec.reference)}`.slice(0, 13),
          variantLabel: label || null,
          costPrice: d(cost),
          sellingPrice: d(variantSpec.price),
          minStockThreshold: d(spec.minStock),
          weightGrams: spec.weightGrams ?? null,
          attributeValues: { create: values.map((value) => ({ attributeValueId: value.id })) },
        },
      });
      variantCount += 1;

      if (spec.isService) continue;

      for (const [index, warehouse] of warehouses.entries()) {
        // Deterministic spread around the base quantity so lists look lived-in.
        const jitter = Number(hash6(sku + index)) % 5;
        const base = index === 0 ? spec.stock : Math.round(spec.stock * 0.4);
        const quantity = Math.max(1, base + jitter - 2);
        await prisma.stockLevel.create({
          data: { variantId: variant.id, warehouseId: warehouse.id, onHand: d(quantity), averageCost: d(cost) },
        });
        await prisma.stockMovement.create({
          data: {
            variantId: variant.id,
            warehouseId: warehouse.id,
            quantity: d(quantity),
            direction: 'IN',
            type: 'OPENING_BALANCE',
            unitCost: d(cost),
            balanceAfter: d(quantity),
            averageCostAfter: d(cost),
            note: 'Opening balance',
          },
        });
      }
    }
  }

  console.log(`  Catalogue    : ${created} products, ${variantCount} variants created`);
}

function skuToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3);
}

/** Deterministic 6-digit suffix, so re-seeding produces the same barcodes. */
function hash6(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1_000_000;
  }
  return String(hash).padStart(6, '0');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
