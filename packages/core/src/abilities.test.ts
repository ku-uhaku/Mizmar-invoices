import { describe, expect, it } from 'vitest';
import { defineAbilityFor, subject, type Role } from './abilities';

const ctx = (role: Role) => ({ role, userId: 'u-1', companyIds: ['co-1', 'co-2'] });

const salesInvoice = (over: Record<string, unknown> = {}) =>
  subject('Document', {
    companyId: 'co-1',
    side: 'SALES',
    type: 'SALES_INVOICE',
    lifecycle: 'DRAFT',
    createdById: 'u-1',
    ...over,
  });

describe('audit log access', () => {
  it.each([
    ['OWNER', true],
    ['ADMIN', true],
    ['ACCOUNTANT', true],
    ['SALES', false],
    ['WAREHOUSE', false],
    ['VIEWER', false],
  ] as const)('%s read = %s', (role, allowed) => {
    expect(defineAbilityFor(ctx(role)).can('read', 'AuditLog')).toBe(allowed);
  });

  it('is not editable by an accountant', () => {
    expect(defineAbilityFor(ctx('ACCOUNTANT')).can('delete', 'AuditLog')).toBe(false);
  });
});

describe('OWNER', () => {
  it('can do everything', () => {
    const ability = defineAbilityFor(ctx('OWNER'));
    expect(ability.can('manage', 'all')).toBe(true);
    expect(ability.can('configure', 'Settings')).toBe(true);
    expect(ability.can('delete', 'Company')).toBe(true);
  });
});

describe('ADMIN', () => {
  const ability = defineAbilityFor(ctx('ADMIN'));

  it('runs the system but cannot delete a legal entity', () => {
    expect(ability.can('configure', 'Settings')).toBe(true);
    expect(ability.can('delete', 'Company')).toBe(false);
  });
});

describe('ACCOUNTANT', () => {
  const ability = defineAbilityFor(ctx('ACCOUNTANT'));

  it('owns the document and payment side', () => {
    expect(ability.can('validate', salesInvoice())).toBe(true);
    expect(ability.can('manage', subject('Payment', { companyId: 'co-1' }))).toBe(true);
    expect(ability.can('configure', subject('TemplateConfig', { companyId: 'co-1' }))).toBe(true);
  });

  it('cannot restate inventory or change cost prices', () => {
    expect(ability.can('create', 'StockAdjustment')).toBe(false);
    expect(ability.can('update', 'ProductVariant', 'costPrice')).toBe(false);
  });

  it('cannot act in a company it has no access to', () => {
    expect(ability.can('validate', salesInvoice({ companyId: 'co-9' }))).toBe(false);
  });
});

describe('SALES', () => {
  const ability = defineAbilityFor(ctx('SALES'));

  it('works the sales side only', () => {
    expect(ability.can('create', salesInvoice())).toBe(true);
    expect(
      ability.can('create', subject('Document', { companyId: 'co-1', side: 'PURCHASE', type: 'PURCHASE_ORDER' })),
    ).toBe(false);
  });

  it('cannot edit a colleague’s document', () => {
    expect(ability.can('update', salesInvoice({ createdById: 'u-2' }))).toBe(false);
    expect(ability.can('update', salesInvoice({ createdById: 'u-1' }))).toBe(true);
  });

  it('cannot edit a document once validated', () => {
    expect(ability.can('update', salesInvoice({ lifecycle: 'VALIDATED' }))).toBe(false);
  });

  it('cannot see cost or margin', () => {
    expect(ability.can('read', 'ProductVariant', 'costPrice')).toBe(false);
    expect(ability.can('read', 'ProductVariant', 'sellingPrice')).toBe(true);
    expect(ability.can('read', subject('Report', { kind: 'MARGIN' }))).toBe(false);
  });
});

describe('WAREHOUSE', () => {
  const ability = defineAbilityFor(ctx('WAREHOUSE'));

  it('ships and receives but does not invoice', () => {
    expect(
      ability.can('validate', subject('Document', { companyId: 'co-1', type: 'DELIVERY_NOTE' })),
    ).toBe(true);
    expect(
      ability.can('validate', subject('Document', { companyId: 'co-1', type: 'SALES_INVOICE' })),
    ).toBe(false);
  });

  it('manages stock freely', () => {
    expect(ability.can('manage', 'StockAdjustment')).toBe(true);
    expect(ability.can('manage', 'StockCount')).toBe(true);
  });

  it('sees no prices and no payments', () => {
    expect(ability.can('read', 'ProductVariant', 'sellingPrice')).toBe(false);
    expect(ability.can('read', 'Payment')).toBe(false);
  });
});

describe('VIEWER', () => {
  const ability = defineAbilityFor(ctx('VIEWER'));

  it('reads but never writes', () => {
    expect(ability.can('read', 'Document')).toBe(true);
    expect(ability.can('create', 'Document')).toBe(false);
    expect(ability.can('validate', 'Document')).toBe(false);
  });

  it('cannot read cost prices or the audit log', () => {
    expect(ability.can('read', 'ProductVariant', 'costPrice')).toBe(false);
    expect(ability.can('read', 'AuditLog')).toBe(false);
  });
});
