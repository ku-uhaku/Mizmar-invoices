import {
  AbilityBuilder,
  createMongoAbility,
  type ForcedSubject,
  type MongoAbility,
} from '@casl/ability';
import type { DocumentSide, DocumentType, Lifecycle } from './documents/types';

/** Tag a plain record (API payload, Prisma row) with its subject type. */
export { subject } from '@casl/ability';

export const ROLES = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export type Action =
  | 'manage'
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'validate'
  | 'cancel'
  | 'convert'
  | 'send'
  | 'export'
  | 'configure';

// ---------------------------------------------------------------------------
// Subject shapes. Only the fields that permissions are actually keyed on are
// declared, so a rule that references a field nobody stores fails to compile.
// ---------------------------------------------------------------------------

export interface DocumentSubject {
  companyId: string;
  side: DocumentSide;
  type: DocumentType;
  lifecycle: Lifecycle;
  createdById: string;
}

export interface ContactSubject {
  createdById: string;
}

export interface MembershipSubject {
  role: Role;
}

export interface CompanyScopedSubject {
  companyId: string;
}

export interface ProductVariantSubject {
  costPrice: string;
  averageCost: string;
  sellingPrice: string;
}

export interface ReportSubject {
  kind: string;
}

type Tagged<Name extends string, Shape> = Shape & ForcedSubject<Name>;

type Abilities =
  | [Action, 'all']
  | [Action, 'Company']
  | [Action, 'Warehouse']
  | [Action, 'Product']
  | [Action, 'StockMovement']
  | [Action, 'StockAdjustment']
  | [Action, 'StockCount']
  | [Action, 'StockTransfer']
  | [Action, 'Settings']
  | [Action, 'AuditLog']
  | [Action, 'Expense']
  | [Action, 'Cash']
  | [Action, 'Employee']
  | [Action, 'Leave']
  | [Action, 'Attendance']
  | [Action, 'Payroll']
  | [Action, 'Document' | Tagged<'Document', DocumentSubject>]
  | [Action, 'Contact' | Tagged<'Contact', ContactSubject>]
  | [Action, 'Membership' | Tagged<'Membership', MembershipSubject>]
  | [Action, 'Payment' | Tagged<'Payment', CompanyScopedSubject>]
  | [Action, 'TemplateConfig' | Tagged<'TemplateConfig', CompanyScopedSubject>]
  | [Action, 'ProductVariant' | Tagged<'ProductVariant', ProductVariantSubject>]
  | [Action, 'Report' | Tagged<'Report', ReportSubject>];

export type Subject = Abilities[1];
export type AppAbility = MongoAbility<Abilities>;

export interface AbilityContext {
  role: Role;
  userId: string;
  /** Companies this membership may act in. */
  companyIds: string[];
}

/**
 * The one definition of who may do what.
 *
 * The API enforces it in a guard; web and mobile load the same abilities so the
 * UI hides exactly what the server would refuse. Two definitions would mean
 * buttons that 403.
 */
export function defineAbilityFor(ctx: AbilityContext): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  const inCompany = { companyId: { $in: ctx.companyIds } };

  switch (ctx.role) {
    case 'OWNER':
      can('manage', 'all');
      break;

    case 'ADMIN':
      can('manage', 'all');
      // Only an owner may remove the organisation's companies or other owners.
      cannot('delete', 'Company');
      cannot('manage', 'Membership', { role: 'OWNER' });
      break;

    case 'ACCOUNTANT':
      can('read', 'all');
      can('manage', 'Document', inCompany);
      can('manage', 'Payment', inCompany);
      can('manage', 'Contact');
      can('manage', 'Expense');
      can('manage', 'Cash');
      can('manage', 'Payroll');
      can('export', 'Report');
      can('configure', 'TemplateConfig', inCompany);
      // Accountants price and invoice; they do not restate inventory valuation.
      cannot('manage', 'StockAdjustment');
      cannot('update', 'ProductVariant', ['costPrice']);
      cannot('configure', 'Settings');
      break;

    case 'SALES':
      can('read', 'Company');
      can('read', 'Warehouse');
      can('read', 'Product');
      can('read', 'ProductVariant');
      can('read', 'Contact');
      can('create', 'Contact');
      can('update', 'Contact', { createdById: ctx.userId });
      can('read', 'Payment', inCompany);
      // A cashier takes the money for the sales they make at the till.
      can('create', 'Payment', inCompany);
      can('read', 'Cash');
      can('create', 'Cash');
      can('update', 'Cash');
      can('read', 'Document', { ...inCompany, side: 'SALES' });
      can('create', 'Document', { ...inCompany, side: 'SALES' });
      can('update', 'Document', {
        ...inCompany,
        side: 'SALES',
        createdById: ctx.userId,
        lifecycle: 'DRAFT',
      });
      can('delete', 'Document', {
        ...inCompany,
        side: 'SALES',
        createdById: ctx.userId,
        lifecycle: 'DRAFT',
      });
      can('validate', 'Document', { ...inCompany, side: 'SALES', createdById: ctx.userId });
      can('convert', 'Document', { ...inCompany, side: 'SALES', createdById: ctx.userId });
      can('send', 'Document', { ...inCompany, side: 'SALES', createdById: ctx.userId });
      // Margin is not a salesperson's to see.
      cannot('read', 'ProductVariant', ['costPrice', 'averageCost']);
      cannot('read', 'Report', { kind: 'MARGIN' });
      break;

    case 'WAREHOUSE':
      can('read', 'Product');
      can('read', 'ProductVariant');
      can('read', 'Warehouse');
      can('read', 'StockMovement');
      can('read', 'Contact');
      can('manage', 'StockAdjustment');
      can('manage', 'StockCount');
      can('manage', 'StockTransfer');
      can('read', 'Document', inCompany);
      // Movement documents only: a warehouse user ships and receives, never prices.
      can('create', 'Document', { ...inCompany, type: { $in: ['DELIVERY_NOTE', 'GOODS_RECEIPT'] } });
      can('update', 'Document', {
        ...inCompany,
        type: { $in: ['DELIVERY_NOTE', 'GOODS_RECEIPT'] },
        lifecycle: 'DRAFT',
      });
      can('validate', 'Document', {
        ...inCompany,
        type: { $in: ['DELIVERY_NOTE', 'GOODS_RECEIPT'] },
      });
      cannot('read', 'ProductVariant', ['costPrice', 'averageCost', 'sellingPrice']);
      cannot('read', 'Payment');
      break;

    case 'VIEWER':
      can('read', 'all');
      cannot('read', 'ProductVariant', ['costPrice', 'averageCost']);
      cannot('read', 'AuditLog');
      // Pay is confidential: a read-only seat sees the directory, never salaries.
      cannot('read', 'Payroll');
      break;
  }

  return build();
}
