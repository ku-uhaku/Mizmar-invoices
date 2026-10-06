export * from './common';
export * from './contract';

export * as authSchemas from './auth';
export * as catalogSchemas from './catalog';
export * as contactSchemas from './contacts';
export * as dashboardSchemas from './dashboard';
export * as documentSchemas from './documents';
export * as inventorySchemas from './inventory';
export * as settingsSchemas from './settings';

export type { SessionUser, AuthTokens, LoginRequest } from './auth';
export type { Contact, ContactCreate, Statement } from './contacts';
export type { Product, ProductVariant, VariantSearchResult } from './catalog';
export type { StockRow, MovementRow, AdjustmentRequest } from './inventory';
export type {
  DocumentDetail,
  DocumentListRow,
  DocumentCreate,
  ConvertRequest,
  ValidationPreview,
} from './documents';
export type { Company, TemplateConfig, TemplateConfigBody } from './settings';
export type { DashboardResponse } from './dashboard';
