/**
 * Turn a matched route into a readable audit action and entity.
 *
 *   POST /api/v1/documents/:id/validate -> documents.validate / Document
 *   PATCH /api/v1/contacts/:id          -> contacts.update   / Contact
 *   POST /api/v1/inventory/stock/adjustments -> inventory.stock.adjustments.create
 */

export interface RouteInput {
  method: string;
  /** Matched route pattern, e.g. /api/v1/documents/:id/validate. */
  pattern: string;
  params?: Record<string, unknown>;
  responseBody?: unknown;
}

export interface DerivedAudit {
  action: string;
  entityType: string;
  entityId: string | null;
}

const VERBS: Record<string, string> = {
  validate: 'validate',
  cancel: 'cancel',
  sent: 'mark_sent',
  duplicate: 'duplicate',
  email: 'send_email',
  convert: 'convert',
  post: 'post',
  lines: 'submit_lines',
  logout: 'logout',
  'change-password': 'change_password',
};

const ENTITY_TYPES: Record<string, string> = {
  documents: 'Document',
  contacts: 'Contact',
  payments: 'Payment',
  companies: 'Company',
  members: 'Membership',
  templates: 'TemplateConfig',
  'catalog.products': 'Product',
  'catalog.attribute-types': 'AttributeType',
  'inventory.warehouses': 'Warehouse',
  'inventory.stock.adjustments': 'StockAdjustment',
  'inventory.stock.transfers': 'StockTransfer',
  'inventory.stock.counts': 'StockCount',
  'companies.vat-rates': 'VatRate',
  'companies.number-sequences': 'NumberSequence',
  auth: 'User',
};

/** POSTs that compute without writing: noise in a journal. */
const NON_MUTATING = [
  /\/preview$/,
  /\/totals-preview$/,
  /\/variant-matrix$/,
  /\/stock\/availability$/,
  /\/pdf$/,
];

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const EXCLUDED = [/^\/api\/v\d+\/auth\/refresh$/, /^\/api\/v\d+\/health/];

export function shouldAudit(method: string, pattern: string): boolean {
  if (!MUTATING.has(method.toUpperCase())) return false;
  if (EXCLUDED.some((re) => re.test(pattern))) return false;
  if (NON_MUTATING.some((re) => re.test(pattern))) return false;
  return true;
}

export function isLoginRoute(method: string, pattern: string): boolean {
  return method.toUpperCase() === 'POST' && /^\/api\/v\d+\/auth\/login$/.test(pattern);
}

export function deriveAudit(input: RouteInput): DerivedAudit {
  const method = input.method.toUpperCase();
  const segments = (input.pattern.replace(/^\/api\/v\d+/, '').split('?')[0] ?? '')
    .split('/')
    .filter(Boolean);

  const params = input.params ?? {};
  let verb: string | undefined;
  const last = segments[segments.length - 1];
  if (last && !last.startsWith(':') && VERBS[last]) {
    verb = VERBS[last];
    segments.pop();
  }

  const resourceSegments = segments.filter((s) => !s.startsWith(':'));
  const resourceKey = resourceSegments.join('.');
  verb ??= method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update';

  const entityType =
    ENTITY_TYPES[resourceKey] ??
    ENTITY_TYPES[resourceSegments[0] ?? ''] ??
    capitalize(singular(resourceSegments[resourceSegments.length - 1] ?? 'unknown'));

  const paramNames = segments.filter((s) => s.startsWith(':')).map((s) => s.slice(1));
  const lastParam = paramNames[paramNames.length - 1];
  const fromParams = lastParam ? params[lastParam] : undefined;
  const fromBody = idOf(input.responseBody);
  // A conversion or creation yields a new record: the response id is the one
  // worth linking to. Otherwise the path names the target.
  const entityId =
    (verb === 'convert' || verb === 'create' ? fromBody : undefined) ??
    (typeof fromParams === 'string' ? fromParams : undefined) ??
    fromBody ??
    null;

  return { action: `${resourceKey || 'unknown'}.${verb}`, entityType, entityId };
}

function idOf(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

function singular(word: string): string {
  const w = word.replace(/-/g, ' ');
  return w.endsWith('s') ? w.slice(0, -1) : w;
}

function capitalize(word: string): string {
  return word
    .split(' ')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}
