import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import * as auth from './auth';
import * as catalog from './catalog';
import * as contacts from './contacts';
import * as dashboard from './dashboard';
import * as docs from './documents';
import * as inventory from './inventory';
import * as settings from './settings';
import { commonErrorResponses, documentTypeEnum, paginated, uuid } from './common';

const c = initContract();

const ok = z.object({ ok: z.literal(true) });

/**
 * Every company-scoped route carries the active legal entity in a header
 * rather than in each path, so the company switcher is a single client-side
 * concern and no route can forget to scope itself.
 */
const companyHeader = z.object({
  'x-company-id': uuid.optional(),
});

const idParams = z.object({ id: uuid });

// ---------------------------------------------------------------------------

const authContract = c.router(
  {
    login: {
      method: 'POST',
      path: '/login',
      body: auth.loginRequest,
      responses: { 200: auth.loginResponse, ...commonErrorResponses },
      summary: 'Exchange credentials for an access and refresh token pair',
    },
    refresh: {
      method: 'POST',
      path: '/refresh',
      body: auth.refreshRequest,
      responses: { 200: auth.authTokens, ...commonErrorResponses },
      summary: 'Rotate a refresh token; reuse of a rotated token revokes the chain',
    },
    logout: {
      method: 'POST',
      path: '/logout',
      body: auth.refreshRequest.partial(),
      responses: { 200: ok, ...commonErrorResponses },
    },
    me: {
      method: 'GET',
      path: '/me',
      responses: { 200: auth.sessionUser, ...commonErrorResponses },
      summary: 'Session user, accessible companies and serialised permissions',
    },
    changePassword: {
      method: 'POST',
      path: '/change-password',
      body: auth.changePasswordRequest,
      responses: { 200: ok, ...commonErrorResponses },
    },
  },
  { pathPrefix: '/auth' },
);

// ---------------------------------------------------------------------------

const companiesContract = c.router(
  {
    list: {
      method: 'GET',
      path: '',
      responses: { 200: z.array(settings.company), ...commonErrorResponses },
    },
    create: {
      method: 'POST',
      path: '',
      body: settings.companyCreate,
      responses: { 201: settings.company, ...commonErrorResponses },
    },
    get: {
      method: 'GET',
      path: '/:id',
      pathParams: idParams,
      responses: { 200: settings.company, ...commonErrorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/:id',
      pathParams: idParams,
      body: settings.companyUpdate,
      responses: { 200: settings.company, ...commonErrorResponses },
    },
    listVatRates: {
      method: 'GET',
      path: '/:id/vat-rates',
      pathParams: idParams,
      responses: { 200: z.array(settings.vatRate), ...commonErrorResponses },
    },
    replaceVatRates: {
      method: 'PUT',
      path: '/:id/vat-rates',
      pathParams: idParams,
      body: z.object({ rates: z.array(settings.vatRateInput) }),
      responses: { 200: z.array(settings.vatRate), ...commonErrorResponses },
    },
    listNumberSequences: {
      method: 'GET',
      path: '/:id/number-sequences',
      pathParams: idParams,
      query: z.object({ year: z.coerce.number().int().optional() }),
      responses: { 200: z.array(settings.numberSequence), ...commonErrorResponses },
    },
    updateNumberSequence: {
      method: 'PATCH',
      path: '/:id/number-sequences/:sequenceId',
      pathParams: idParams.extend({ sequenceId: uuid }),
      body: settings.numberSequenceUpdate,
      responses: { 200: settings.numberSequence, ...commonErrorResponses },
    },
  },
  { pathPrefix: '/companies' },
);

const membersContract = c.router(
  {
    list: {
      method: 'GET',
      path: '',
      responses: { 200: z.array(settings.membership), ...commonErrorResponses },
    },
    invite: {
      method: 'POST',
      path: '',
      body: settings.membershipInvite,
      responses: { 201: settings.membership, ...commonErrorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/:id',
      pathParams: idParams,
      body: settings.membershipUpdate,
      responses: { 200: settings.membership, ...commonErrorResponses },
    },
    remove: {
      method: 'DELETE',
      path: '/:id',
      pathParams: idParams,
      responses: { 200: ok, ...commonErrorResponses },
    },
  },
  { pathPrefix: '/members' },
);

const templatesContract = c.router(
  {
    list: {
      method: 'GET',
      path: '',
      headers: companyHeader,
      query: z.object({ documentType: documentTypeEnum.optional() }),
      responses: { 200: z.array(settings.templateConfig), ...commonErrorResponses },
    },
    create: {
      method: 'POST',
      path: '',
      headers: companyHeader,
      body: settings.templateConfigCreate,
      responses: { 201: settings.templateConfig, ...commonErrorResponses },
    },
    get: {
      method: 'GET',
      path: '/:id',
      pathParams: idParams,
      headers: companyHeader,
      responses: { 200: settings.templateConfig, ...commonErrorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/:id',
      pathParams: idParams,
      headers: companyHeader,
      body: settings.templateConfigUpdate,
      responses: { 200: settings.templateConfig, ...commonErrorResponses },
      summary: 'Saving bumps `version`, which is what makes reprints reproducible',
    },
    remove: {
      method: 'DELETE',
      path: '/:id',
      pathParams: idParams,
      headers: companyHeader,
      responses: { 200: ok, ...commonErrorResponses },
    },
    preview: {
      method: 'POST',
      path: '/preview',
      headers: companyHeader,
      body: settings.templatePreviewRequest,
      responses: { 200: settings.templatePreviewResponse, ...commonErrorResponses },
      summary: 'Render the live preview HTML without saving the template',
    },
  },
  { pathPrefix: '/templates' },
);

// ---------------------------------------------------------------------------

const contactsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '',
      headers: companyHeader,
      query: contacts.contactListQuery,
      responses: { 200: paginated(contacts.contact), ...commonErrorResponses },
    },
    create: {
      method: 'POST',
      path: '',
      body: contacts.contactCreate,
      responses: { 201: contacts.contact, ...commonErrorResponses },
    },
    get: {
      method: 'GET',
      path: '/:id',
      pathParams: idParams,
      responses: { 200: contacts.contact, ...commonErrorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/:id',
      pathParams: idParams,
      body: contacts.contactUpdate,
      responses: { 200: contacts.contact, ...commonErrorResponses },
    },
    remove: {
      method: 'DELETE',
      path: '/:id',
      pathParams: idParams,
      responses: { 200: ok, ...commonErrorResponses },
    },
    statement: {
      method: 'GET',
      path: '/:id/statement',
      pathParams: idParams,
      headers: companyHeader,
      query: z.object({ from: z.string().optional(), to: z.string().optional() }),
      responses: { 200: contacts.statement, ...commonErrorResponses },
      summary: 'Aged account statement: unpaid invoices, payments, running balance',
    },
  },
  { pathPrefix: '/contacts' },
);

// ---------------------------------------------------------------------------

const catalogContract = c.router(
  {
    listAttributeTypes: {
      method: 'GET',
      path: '/attribute-types',
      responses: { 200: z.array(catalog.attributeType), ...commonErrorResponses },
    },
    createAttributeType: {
      method: 'POST',
      path: '/attribute-types',
      body: catalog.attributeTypeCreate,
      responses: { 201: catalog.attributeType, ...commonErrorResponses },
    },
    updateAttributeType: {
      method: 'PATCH',
      path: '/attribute-types/:id',
      pathParams: idParams,
      body: catalog.attributeTypeCreate.partial(),
      responses: { 200: catalog.attributeType, ...commonErrorResponses },
    },
    listProducts: {
      method: 'GET',
      path: '/products',
      query: catalog.productListQuery,
      responses: { 200: paginated(catalog.product), ...commonErrorResponses },
    },
    createProduct: {
      method: 'POST',
      path: '/products',
      body: catalog.productCreate,
      responses: { 201: catalog.product, ...commonErrorResponses },
    },
    getProduct: {
      method: 'GET',
      path: '/products/:id',
      pathParams: idParams,
      responses: { 200: catalog.product, ...commonErrorResponses },
    },
    updateProduct: {
      method: 'PATCH',
      path: '/products/:id',
      pathParams: idParams,
      body: catalog.productUpdate,
      responses: { 200: catalog.product, ...commonErrorResponses },
    },
    removeProduct: {
      method: 'DELETE',
      path: '/products/:id',
      pathParams: idParams,
      responses: { 200: ok, ...commonErrorResponses },
    },
    variantMatrix: {
      method: 'POST',
      path: '/products/variant-matrix',
      body: catalog.variantMatrixRequest,
      responses: { 200: catalog.variantMatrixResponse, ...commonErrorResponses },
      summary: 'Preview the attribute cross-product with suggested SKUs',
    },
    searchVariants: {
      method: 'GET',
      path: '/variants/search',
      headers: companyHeader,
      query: catalog.variantSearchQuery,
      responses: { 200: z.array(catalog.variantSearchResult), ...commonErrorResponses },
      summary: 'The document editor line picker: SKU, barcode, name and attributes',
    },
  },
  { pathPrefix: '/catalog' },
);

// ---------------------------------------------------------------------------

const inventoryContract = c.router(
  {
    listWarehouses: {
      method: 'GET',
      path: '/warehouses',
      responses: { 200: z.array(inventory.warehouse), ...commonErrorResponses },
    },
    createWarehouse: {
      method: 'POST',
      path: '/warehouses',
      body: inventory.warehouseCreate,
      responses: { 201: inventory.warehouse, ...commonErrorResponses },
    },
    updateWarehouse: {
      method: 'PATCH',
      path: '/warehouses/:id',
      pathParams: idParams,
      body: inventory.warehouseCreate.partial().extend({ isActive: z.boolean().optional() }),
      responses: { 200: inventory.warehouse, ...commonErrorResponses },
    },
    stock: {
      method: 'GET',
      path: '/stock',
      query: inventory.stockListQuery,
      responses: { 200: paginated(inventory.stockRow), ...commonErrorResponses },
    },
    availability: {
      method: 'POST',
      path: '/stock/availability',
      body: inventory.availabilityQuery,
      responses: { 200: z.array(inventory.availabilityRow), ...commonErrorResponses },
    },
    movements: {
      method: 'GET',
      path: '/stock/movements',
      query: inventory.movementListQuery,
      responses: { 200: paginated(inventory.movementRow), ...commonErrorResponses },
      summary: 'The audit log: every movement with document, user and reason',
    },
    adjust: {
      method: 'POST',
      path: '/stock/adjustments',
      body: inventory.adjustmentRequest,
      responses: { 201: z.array(inventory.movementRow), ...commonErrorResponses },
    },
    transfer: {
      method: 'POST',
      path: '/stock/transfers',
      body: inventory.transferRequest,
      responses: { 201: z.array(inventory.movementRow), ...commonErrorResponses },
    },
    listCountSessions: {
      method: 'GET',
      path: '/stock/counts',
      query: z.object({ warehouseId: uuid.optional(), status: z.string().optional() }),
      responses: { 200: z.array(inventory.countSession), ...commonErrorResponses },
    },
    createCountSession: {
      method: 'POST',
      path: '/stock/counts',
      body: inventory.countSessionCreate,
      responses: { 201: inventory.countSession, ...commonErrorResponses },
    },
    getCountSession: {
      method: 'GET',
      path: '/stock/counts/:id',
      pathParams: idParams,
      responses: { 200: inventory.countSession, ...commonErrorResponses },
    },
    submitCount: {
      method: 'POST',
      path: '/stock/counts/:id/lines',
      pathParams: idParams,
      body: inventory.countSubmitRequest,
      responses: { 200: inventory.countSession, ...commonErrorResponses },
    },
    postCount: {
      method: 'POST',
      path: '/stock/counts/:id/post',
      pathParams: idParams,
      body: z.object({ note: z.string().max(1000).optional() }),
      responses: { 200: inventory.countSession, ...commonErrorResponses },
      summary: 'Turn approved variances into COUNT_CORRECTION ledger rows',
    },
  },
  { pathPrefix: '/inventory' },
);

// ---------------------------------------------------------------------------

const documentsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '',
      headers: companyHeader,
      query: docs.documentListQuery,
      responses: { 200: paginated(docs.documentListRow), ...commonErrorResponses },
    },
    create: {
      method: 'POST',
      path: '',
      headers: companyHeader,
      body: docs.documentCreate,
      responses: { 201: docs.documentDetail, ...commonErrorResponses },
    },
    get: {
      method: 'GET',
      path: '/:id',
      pathParams: idParams,
      headers: companyHeader,
      responses: { 200: docs.documentDetail, ...commonErrorResponses },
    },
    update: {
      method: 'PATCH',
      path: '/:id',
      pathParams: idParams,
      headers: companyHeader,
      body: docs.documentUpdate,
      responses: { 200: docs.documentDetail, ...commonErrorResponses },
      summary: 'Drafts only; a validated document is immutable',
    },
    remove: {
      method: 'DELETE',
      path: '/:id',
      pathParams: idParams,
      headers: companyHeader,
      responses: { 200: ok, ...commonErrorResponses },
    },
    duplicate: {
      method: 'POST',
      path: '/:id/duplicate',
      pathParams: idParams,
      headers: companyHeader,
      body: z.object({ issueDate: z.string().optional() }),
      responses: { 201: docs.documentDetail, ...commonErrorResponses },
    },
    validationPreview: {
      method: 'POST',
      path: '/:id/validate/preview',
      pathParams: idParams,
      headers: companyHeader,
      body: z.object({}),
      responses: { 200: docs.validationPreview, ...commonErrorResponses },
      summary: 'The exact stock movements and number about to be written',
    },
    validate: {
      method: 'POST',
      path: '/:id/validate',
      pathParams: idParams,
      headers: companyHeader,
      body: docs.validateRequest,
      responses: { 200: docs.documentDetail, ...commonErrorResponses },
      summary: 'Allocate the number and write stock movements in one transaction',
    },
    markSent: {
      method: 'POST',
      path: '/:id/sent',
      pathParams: idParams,
      headers: companyHeader,
      body: z.object({}),
      responses: { 200: docs.documentDetail, ...commonErrorResponses },
    },
    cancel: {
      method: 'POST',
      path: '/:id/cancel',
      pathParams: idParams,
      headers: companyHeader,
      body: docs.cancelRequest,
      responses: { 200: docs.documentDetail, ...commonErrorResponses },
      summary: 'Writes compensating ledger rows; refused if drawn downstream',
    },
    conversionOptions: {
      method: 'GET',
      path: '/:id/conversion-options',
      pathParams: idParams,
      headers: companyHeader,
      query: z.object({
        targetType: documentTypeEnum,
        /** Additional sources to consolidate into one target. */
        alsoInclude: z.union([uuid, z.array(uuid)]).optional(),
      }),
      responses: { 200: docs.conversionOptions, ...commonErrorResponses },
      summary: 'Per-line ordered / already drawn / remaining for the dialog',
    },
    convert: {
      method: 'POST',
      path: '/convert',
      headers: companyHeader,
      body: docs.convertRequest,
      responses: { 201: docs.documentDetail, ...commonErrorResponses },
      summary: 'One-click conversion, supporting partial and multi-source',
    },
    totalsPreview: {
      method: 'POST',
      path: '/totals-preview',
      headers: companyHeader,
      body: docs.totalsPreviewRequest,
      responses: { 200: docs.totalsPreviewResponse, ...commonErrorResponses },
    },
    renderPdf: {
      method: 'POST',
      path: '/:id/pdf',
      pathParams: idParams,
      headers: companyHeader,
      body: docs.pdfRenderRequest,
      responses: { 200: docs.pdfRenderResponse, ...commonErrorResponses },
    },
    sendEmail: {
      method: 'POST',
      path: '/:id/email',
      pathParams: idParams,
      headers: companyHeader,
      body: docs.sendEmailRequest,
      responses: { 200: ok, ...commonErrorResponses },
    },
  },
  { pathPrefix: '/documents' },
);

const paymentsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '',
      headers: companyHeader,
      query: z.object({
        contactId: uuid.optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      responses: { 200: paginated(docs.payment), ...commonErrorResponses },
    },
    create: {
      method: 'POST',
      path: '',
      headers: companyHeader,
      body: docs.paymentCreate,
      responses: { 201: docs.payment, ...commonErrorResponses },
      summary: 'Record a payment and allocate it across documents',
    },
    remove: {
      method: 'DELETE',
      path: '/:id',
      pathParams: idParams,
      headers: companyHeader,
      responses: { 200: ok, ...commonErrorResponses },
    },
  },
  { pathPrefix: '/payments' },
);

const dashboardContract = c.router(
  {
    get: {
      method: 'GET',
      path: '',
      headers: companyHeader,
      query: dashboard.dashboardQuery,
      responses: { 200: dashboard.dashboardResponse, ...commonErrorResponses },
    },
  },
  { pathPrefix: '/dashboard' },
);

const healthContract = c.router({
  health: {
    method: 'GET',
    path: '/health',
    responses: {
      200: z.object({
        status: z.literal('ok'),
        version: z.string(),
        database: z.boolean(),
        redis: z.boolean(),
        storage: z.boolean(),
      }),
    },
  },
});

export const apiContract = c.router(
  {
    health: healthContract,
    auth: authContract,
    companies: companiesContract,
    members: membersContract,
    templates: templatesContract,
    contacts: contactsContract,
    catalog: catalogContract,
    inventory: inventoryContract,
    documents: documentsContract,
    payments: paymentsContract,
    dashboard: dashboardContract,
  },
  {
    pathPrefix: '/api/v1',
    strictStatusCodes: true,
    commonResponses: {},
  },
);

export type ApiContract = typeof apiContract;
