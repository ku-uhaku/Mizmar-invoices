/**
 * Demo dataset.
 *
 * Builds the world the manual verification script in the plan walks through:
 * two legal entities in one organization, two warehouses, a product with 12
 * variants, clients, suppliers and one user per role. Idempotent — safe to run
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

  // ---- Attributes --------------------------------------------------------
  const colour = await upsertAttribute(organization.id, 'COLOR', 'Couleur', 0, [
    { value: 'Rouge', colorHex: '#DC2626' },
    { value: 'Bleu', colorHex: '#2563EB' },
    { value: 'Noir', colorHex: '#111827' },
  ]);
  const size = await upsertAttribute(organization.id, 'SIZE', 'Taille', 1, [
    { value: 'S' },
    { value: 'M' },
    { value: 'L' },
    { value: 'XL' },
  ]);

  // ---- A product with 12 variants (3 colours x 4 sizes) ------------------
  const existingProduct = await prisma.product.findFirst({
    where: { organizationId: organization.id, reference: 'POLO-CLS' },
  });

  if (!existingProduct) {
    const product = await prisma.product.create({
      data: {
        organizationId: organization.id,
        name: 'Polo Classique',
        reference: 'POLO-CLS',
        description: 'Polo coton piqué, coupe droite',
        category: 'Textile',
        brand: 'Mizmar',
        unitId: unitPiece.id,
        defaultVatRate: d(20),
        isVariantManaged: true,
        attributes: {
          create: [
            { attributeTypeId: colour.id, sortOrder: 0 },
            { attributeTypeId: size.id, sortOrder: 1 },
          ],
        },
      },
    });

    for (const colourValue of colour.values) {
      for (const sizeValue of size.values) {
        const sku = `POLO-${skuToken(colourValue.value)}-${sizeValue.value}`;
        const variant = await prisma.productVariant.create({
          data: {
            productId: product.id,
            sku,
            barcode: `610000${hash6(sku)}`,
            variantLabel: `${colourValue.value} / ${sizeValue.value}`,
            costPrice: d('85.00'),
            sellingPrice: d('149.00'),
            minStockThreshold: d(10),
            weightGrams: 220,
            attributeValues: {
              create: [
                { attributeValueId: colourValue.id },
                { attributeValueId: sizeValue.id },
              ],
            },
          },
        });

        // Opening stock goes through the ledger, like every other movement, so
        // day-one quantities are auditable instead of appearing from nowhere.
        for (const [warehouse, quantity] of [
          [warehouseA, 60],
          [warehouseB, 25],
        ] as const) {
          await prisma.stockLevel.create({
            data: {
              variantId: variant.id,
              warehouseId: warehouse.id,
              onHand: d(quantity),
              averageCost: d('85.00'),
            },
          });
          await prisma.stockMovement.create({
            data: {
              variantId: variant.id,
              warehouseId: warehouse.id,
              quantity: d(quantity),
              direction: 'IN',
              type: 'OPENING_BALANCE',
              unitCost: d('85.00'),
              balanceAfter: d(quantity),
              averageCostAfter: d('85.00'),
              note: 'Opening balance',
            },
          });
        }
      }
    }

    // A service line, to prove services never touch stock.
    const serviceProduct = await prisma.product.create({
      data: {
        organizationId: organization.id,
        name: 'Frais de livraison',
        reference: 'SRV-DELIV',
        category: 'Services',
        unitId: unitPiece.id,
        defaultVatRate: d(20),
        isVariantManaged: false,
        isService: true,
      },
    });
    await prisma.productVariant.create({
      data: {
        productId: serviceProduct.id,
        sku: 'SRV-DELIV',
        sellingPrice: d('150.00'),
        costPrice: d('0.00'),
      },
    });
  }

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
      displayName: 'Textile Import Co',
      legalName: 'TEXTILE IMPORT CO SARL',
      ice: '005566778800012',
      email: 'sales@textile-import.ma',
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
