import {
  amountToWords,
  directionFor,
  formatDate,
  formatMoney,
  formatNumber,
  translator,
  type DateFormat,
  type MessageKey,
  type Translate,
} from '@mizmar/i18n';
import { buildCss, pageDimensions } from './css';
import type {
  Locale,
  RenderAddress,
  RenderData,
  RenderLine,
  RenderOptions,
  TemplateConfigBody,
} from './types';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Everything interpolated into the template goes through this. */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

/** Escape then turn newlines into <br>, for user-entered prose blocks. */
function escMultiline(value: unknown): string {
  return esc(value).replace(/\r?\n/g, '<br>');
}

/**
 * Force left-to-right ordering for a number.
 *
 * In an Arabic document the bidi algorithm reorders "1 490,00 DH" into
 * "DH 490,00 1", because the thousands space and the currency letters are
 * separate runs. An explicit LTR span pins the whole group, which is what the
 * reader expects of an amount regardless of the surrounding script.
 */
function ltr(value: string): string {
  return `<span dir="ltr">${esc(value)}</span>`;
}

/**
 * Isolate a run whose direction may differ from the document's.
 *
 * A Latin company name or street address inside an Arabic invoice otherwise
 * has its words resequenced ("12 Rue Ibn Batouta" becomes "Rue Ibn Batouta 12").
 */
function bdi(value: unknown): string {
  return `<bdi>${esc(value)}</bdi>`;
}

interface Formatters {
  t: Translate;
  /** Returns HTML, bidi-pinned to LTR. */
  money: (value: string, hideCurrency?: boolean) => string;
  qty: (value: string) => string;
  rate: (value: string) => string;
  date: (value: string | null | undefined) => string;
  isRtl: boolean;
}

function buildFormatters(config: TemplateConfigBody, locale: Locale, currency: string): Formatters {
  const options = config.localeOptions;
  const numberOptions = {
    decimalSeparator: options.decimalSeparator,
    thousandsSeparator: options.thousandsSeparator,
    arabicIndicDigits: options.useArabicIndicDigits,
  };

  return {
    t: translator(locale),
    money: (value, hideCurrency) =>
      ltr(
        formatMoney(value, {
          ...numberOptions,
          currency: options.currency || currency,
          symbolPosition: options.currencySymbolPosition,
          hideCurrency,
          decimals: 2,
        }),
      ),
    // Quantities print without trailing zeros: "4" reads better than "4.000000",
    // but "1.5" must survive.
    qty: (value) =>
      ltr(formatNumber(trimQuantity(value), { ...numberOptions, decimals: quantityDecimals(value) })),
    rate: (value) => ltr(formatNumber(value, { ...numberOptions, decimals: rateDecimals(value) })),
    date: (value) =>
      value
        ? ltr(
            formatDate(value, options.dateFormat as DateFormat, {
              arabicIndicDigits: options.useArabicIndicDigits,
            }),
          )
        : '',
    isRtl:
      options.direction === 'RTL' || (options.direction === 'AUTO' && locale === 'AR'),
  };
}

function trimQuantity(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

function quantityDecimals(value: string): number {
  const fraction = trimQuantity(value).split('.')[1] ?? '';
  return Math.min(fraction.length, 3);
}

function rateDecimals(value: string): number {
  const fraction = value.split('.')[1]?.replace(/0+$/, '') ?? '';
  return fraction.length > 0 ? Math.min(fraction.length, 2) : 0;
}

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

function addressLines(address: RenderAddress | null | undefined): string[] {
  if (!address) return [];
  return [
    address.addressLine1,
    address.addressLine2,
    [address.postalCode, address.city].filter(Boolean).join(' '),
    address.country && address.country !== 'MA' ? address.country : null,
  ]
    .map((line) => (line ?? '').trim())
    .filter(Boolean);
}

function companyLegalLine(data: RenderData, f: Formatters): string {
  const { company } = data;
  const parts: string[] = [];
  const add = (key: MessageKey, value: string | null | undefined) => {
    if (value) parts.push(`<span>${f.t(key)}: ${bdi(value)}</span>`);
  };

  add('legal.ice', company.ice);
  add('legal.rc', company.rc);
  add('legal.if', company.taxId);
  add('legal.patente', company.patente);
  add('legal.cnss', company.cnss);
  if (company.shareCapital) {
    parts.push(`<span>${f.t('legal.capital')}: ${f.money(company.shareCapital)}</span>`);
  }
  return joinLegal(parts);
}

function companyContactLine(data: RenderData, f: Formatters): string {
  const { company } = data;
  const parts: string[] = [];
  const phones = [company.phone, company.phone2].filter(Boolean).join(' / ');
  if (phones) parts.push(`<span>${f.t('legal.tel')}: ${bdi(phones)}</span>`);
  if (company.email) parts.push(`<span>${bdi(company.email)}</span>`);
  if (company.website) parts.push(`<span>${bdi(company.website)}</span>`);
  return joinLegal(parts);
}

/**
 * Join legal/contact items with a separator that can break.
 *
 * Each item stays nowrap so an ICE number never splits across lines, but the
 * separator between them is an ordinary text node, which gives the line
 * somewhere to wrap instead of running off the page.
 */
function joinLegal(parts: string[]): string {
  return parts.join('<span class="sep"> · </span>');
}

function renderHeader(data: RenderData, config: TemplateConfigBody, f: Formatters): string {
  const { company } = data;
  const layout = config.branding.headerLayout;
  const logo =
    config.branding.logoAssetId && company.logoUrl
      ? `<div class="logo-slot pos-${config.branding.logoPosition.toLowerCase()}"><img class="logo" src="${esc(company.logoUrl)}" alt=""></div>`
      : '';

  const addressBlock = addressLines(company.address).map((line) => bdi(line)).join('<br>');

  const companyBlock = `
    <div class="company-block">
      <div class="company-name">${bdi(company.legalName || company.name)}</div>
      ${company.legalForm ? `<div class="company-legal"><span>${bdi(company.legalForm)}</span></div>` : ''}
      ${addressBlock ? `<div class="company-legal">${addressBlock}</div>` : ''}
      <div class="company-legal">${companyContactLine(data, f)}</div>
      <div class="company-legal">${companyLegalLine(data, f)}</div>
    </div>`;

  // The banner and centred layouts stack the logo above the company block;
  // the default puts them side by side with the logo on the leading edge.
  const body =
    layout === 'LOGO_CENTER' || layout === 'BANNER'
      ? `${logo}${companyBlock}`
      : config.branding.logoPosition === 'RIGHT'
        ? `${companyBlock}${logo}`
        : `${logo}${companyBlock}`;

  return `<header class="doc-header layout-${layout.toLowerCase().replace('logo_', '')}">${body}</header>`;
}

function renderTitleRow(data: RenderData, f: Formatters): string {
  const { document } = data;
  const rows: Array<[string, string]> = [];

  rows.push([f.t('field.date'), f.date(document.issueDate)]);
  if (document.dueDate) rows.push([f.t('field.dueDate'), f.date(document.dueDate)]);
  if (document.validUntil) rows.push([f.t('field.validUntil'), f.date(document.validUntil)]);
  if (document.deliveryDate) rows.push([f.t('field.deliveryDate'), f.date(document.deliveryDate)]);
  if (document.reference) rows.push([f.t('field.reference'), bdi(document.reference)]);
  if (document.projectName) rows.push([f.t('field.project'), bdi(document.projectName)]);
  if (data.warehouseName) rows.push([f.t('field.warehouse'), bdi(data.warehouseName)]);
  if (data.salespersonName) rows.push([f.t('field.salesperson'), bdi(data.salespersonName)]);

  return `
    <div class="title-row">
      <div>
        <h1 class="doc-title">${f.t(`doc.${document.type}` as MessageKey)}</h1>
        ${document.number ? `<div class="doc-number">${f.t('field.number')} ${esc(document.number)}</div>` : ''}
      </div>
      <table class="meta-table">
        ${rows.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${value}</td></tr>`).join('')}
      </table>
    </div>`;
}

function renderParties(data: RenderData, config: TemplateConfigBody, f: Formatters): string {
  const { contact, document } = data;
  const isPurchase =
    document.type === 'PURCHASE_ORDER' ||
    document.type === 'GOODS_RECEIPT' ||
    document.type === 'PURCHASE_INVOICE';

  const taxLines = config.content.showContactTaxIds
    ? [
        contact.ice ? `${f.t('legal.ice')}: ${contact.ice}` : null,
        contact.rc ? `${f.t('legal.rc')}: ${contact.rc}` : null,
        contact.taxId ? `${f.t('legal.if')}: ${contact.taxId}` : null,
      ].filter(Boolean)
    : [];

  const billing = `
    <div class="party">
      <div class="party-label">${f.t(isPurchase ? 'field.supplier' : 'field.billTo')}</div>
      <div class="party-name">${bdi(contact.legalName || contact.displayName)}</div>
      ${addressLines(contact.billingAddress).map((line) => `<div class="party-line">${bdi(line)}</div>`).join('')}
      ${contact.phone ? `<div class="party-line">${f.t('legal.tel')}: ${bdi(contact.phone)}</div>` : ''}
      ${taxLines.map((line) => `<div class="party-line">${bdi(line)}</div>`).join('')}
    </div>`;

  // A separate shipping address only earns its space when it differs.
  const shipping =
    contact.shippingAddress &&
    addressLines(contact.shippingAddress).join('|') !== addressLines(contact.billingAddress).join('|')
      ? `
    <div class="party">
      <div class="party-label">${f.t('field.shipTo')}</div>
      <div class="party-name">${bdi(contact.displayName)}</div>
      ${addressLines(contact.shippingAddress).map((line) => `<div class="party-line">${bdi(line)}</div>`).join('')}
    </div>`
      : '';

  return `<div class="parties">${billing}${shipping}</div>`;
}

interface ColumnSpec {
  key: string;
  label: string;
  numeric: boolean;
  render: (line: RenderLine, index: number) => string;
}

function buildColumns(config: TemplateConfigBody, f: Formatters): ColumnSpec[] {
  const { columns } = config;
  const specs: ColumnSpec[] = [];

  specs.push({
    key: 'index',
    label: f.t('col.index'),
    numeric: true,
    render: (_line, index) => String(index + 1),
  });

  if (columns.showImage) {
    specs.push({
      key: 'image',
      label: f.t('col.image'),
      numeric: false,
      render: (line) =>
        line.imageUrl ? `<img class="line-image" src="${esc(line.imageUrl)}" alt="">` : '',
    });
  }

  specs.push({
    key: 'description',
    label: f.t('col.description'),
    numeric: false,
    render: (line) =>
      [
        `<div class="line-desc">${escMultiline(line.description)}</div>`,
        line.variantLabel ? `<div class="line-variant">${esc(line.variantLabel)}</div>` : '',
        // SKU and barcode sit under the description rather than in their own
        // columns when space is tight, which keeps a 10-column invoice readable.
        columns.showSku && line.sku ? `<div class="line-sku">${f.t('col.sku')}: ${bdi(line.sku)}</div>` : '',
        columns.showBarcode && line.barcode
          ? `<div class="line-sku">${f.t('col.barcode')}: ${bdi(line.barcode)}</div>`
          : '',
      ]
        .filter(Boolean)
        .join(''),
  });

  if (columns.showSourceReference) {
    specs.push({
      key: 'source',
      label: f.t('col.sourceReference'),
      numeric: false,
      render: (line) => bdi(line.sourceReference ?? ''),
    });
  }

  specs.push({
    key: 'quantity',
    label: f.t('col.quantity'),
    numeric: true,
    render: (line) => f.qty(line.quantity),
  });

  if (columns.showUnit) {
    specs.push({
      key: 'unit',
      label: f.t('col.unit'),
      numeric: false,
      render: (line) => bdi(line.unitCode ?? ''),
    });
  }

  specs.push({
    key: 'unitPrice',
    label: f.t('col.unitPrice'),
    numeric: true,
    render: (line) => f.money(line.unitPrice, true),
  });

  if (columns.showLineDiscount) {
    specs.push({
      key: 'discount',
      label: f.t('col.discount'),
      numeric: true,
      render: (line) => {
        if (!line.discountKind || !line.discountValue) return '—';
        return line.discountKind === 'PERCENT'
          ? `<span dir="ltr">${f.rate(line.discountValue)}&nbsp;%</span>`
          : f.money(line.discountValue, true);
      },
    });
  }

  if (columns.showVatPerLine) {
    specs.push({
      key: 'vat',
      label: f.t('col.vat'),
      numeric: true,
      render: (line) => `<span dir="ltr">${f.rate(line.vatRate)}&nbsp;%</span>`,
    });
  }

  specs.push({
    key: 'total',
    label: f.t('col.lineTotal'),
    numeric: true,
    render: (line) => f.money(line.taxableBase, true),
  });

  return specs;
}

function renderLines(data: RenderData, config: TemplateConfigBody, f: Formatters): string {
  const columns = buildColumns(config, f);
  let payableIndex = -1;

  const rows = data.document.lines
    .map((line) => {
      if (line.isNote) {
        // A heading spans the table so it reads as a section, not a row of
        // blanks where numbers should be.
        return `<tr class="note-row"><td colspan="${columns.length}">${escMultiline(line.description)}</td></tr>`;
      }
      payableIndex += 1;
      const index = payableIndex;
      return `<tr>${columns
        .map(
          (column) =>
            `<td class="${column.numeric ? 'num' : ''}${column.key === 'description' ? ' col-desc' : ''}">${column.render(line, index)}</td>`,
        )
        .join('')}</tr>`;
    })
    .join('');

  return `
    <table class="lines">
      <thead>
        <tr>${columns
          .map(
            (column) =>
              `<th class="${column.numeric ? 'num' : ''}${column.key === 'description' ? ' col-desc' : ''}">${esc(column.label)}</th>`,
          )
          .join('')}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderTotals(
  data: RenderData,
  config: TemplateConfigBody,
  f: Formatters,
  locale: Locale,
): string {
  const { totals, currency } = data.document;
  const { content } = config;

  const vatSummary =
    content.showVatSummaryTable && totals.vatBuckets.length > 0
      ? `
      <table class="vat-summary">
        <caption>${f.t('block.vatSummary')}</caption>
        <thead>
          <tr>
            <th>${f.t('total.vatRate')}</th>
            <th>${f.t('total.vatBase')}</th>
            <th>${f.t('total.vatAmount')}</th>
          </tr>
        </thead>
        <tbody>
          ${totals.vatBuckets
            .map(
              (bucket) => `<tr>
            <td><span dir="ltr">${f.rate(bucket.rate)}&nbsp;%</span></td>
            <td>${f.money(bucket.base, true)}</td>
            <td>${f.money(bucket.amount, true)}</td>
          </tr>`,
            )
            .join('')}
        </tbody>
      </table>`
      : '';

  const words = content.showAmountInWords
    ? `
      <div class="amount-in-words">
        <div class="label">${f.t('total.amountInWords')}</div>
        <div class="value">${esc(
          amountToWords(totals.totalInclVat, locale, { currency: config.localeOptions.currency || currency }),
        )}</div>
      </div>`
    : '';

  const rows: string[] = [];
  const row = (label: string, value: string, className = '') =>
    rows.push(`<tr class="${className}"><th>${esc(label)}</th><td>${value}</td></tr>`);

  row(f.t('total.subtotal'), f.money(totals.subtotalGross));
  if (totals.totalLineDiscounts !== '0.00') {
    row(f.t('total.lineDiscounts'), `− ${f.money(totals.totalLineDiscounts)}`);
  }
  if (totals.globalDiscount !== '0.00') {
    row(f.t('total.globalDiscount'), `− ${f.money(totals.globalDiscount)}`, 'subtle');
  }
  if (totals.shippingNet !== '0.00') {
    row(f.t('total.shipping'), f.money(totals.shippingNet));
  }
  row(f.t('total.exclVat'), f.money(totals.totalExclVat), 'subtle');
  row(f.t('total.vat'), f.money(totals.totalVat));
  row(f.t('total.inclVat'), f.money(totals.totalInclVat), 'grand');

  // The deposit/balance pair only means anything once something was paid.
  if (
    content.showDepositAndBalance &&
    data.document.paidAmount &&
    data.document.paidAmount !== '0.00'
  ) {
    row(f.t('total.paid'), `− ${f.money(data.document.paidAmount)}`);
    row(f.t('total.balanceDue'), f.money(data.document.outstandingAmount ?? '0.00'), 'due');
  }

  return `
    <div class="totals-block">
      <div class="totals-left">${vatSummary}${words}</div>
      <div class="totals-right"><table class="totals">${rows.join('')}</table></div>
    </div>`;
}

function renderFooterBlocks(data: RenderData, config: TemplateConfigBody, f: Formatters): string {
  const { content } = config;
  const { company, document } = data;
  const blocks: string[] = [];

  if (document.notes) {
    blocks.push(`<div class="footer-block"><h4>${f.t('block.notes')}</h4><p>${escMultiline(document.notes)}</p></div>`);
  }

  if (content.showPaymentInstructions && content.paymentInstructions) {
    blocks.push(
      `<div class="footer-block"><h4>${f.t('block.paymentInstructions')}</h4><p>${escMultiline(content.paymentInstructions)}</p></div>`,
    );
  }

  if (content.showBankDetails && (company.bankName || company.rib || company.iban)) {
    const line = (key: MessageKey, value: string | null | undefined) =>
      value ? `<div class="bank-line"><span class="k">${f.t(key)}</span><span class="v">${bdi(value)}</span></div>` : '';
    blocks.push(`
      <div class="footer-block">
        <h4>${f.t('block.bankDetails')}</h4>
        ${line('block.bank', company.bankName)}
        ${line('block.rib', company.rib)}
        ${line('block.iban', company.iban)}
        ${line('block.swift', company.swift)}
      </div>`);
  }

  const terms = document.terms || content.termsAndConditions;
  if (content.showTermsAndConditions && terms) {
    blocks.push(`<div class="footer-block"><h4>${f.t('block.terms')}</h4><p>${escMultiline(terms)}</p></div>`);
  }

  const signatures =
    content.showSignatureZones || config.branding.showStamp || config.branding.showSignature
      ? `
      <div class="signatures">
        <div class="signature-zone">
          <div class="zone-label">${f.t('block.clientSignature')}</div>
        </div>
        <div class="signature-zone">
          <div class="zone-label">${f.t('block.companySignature')}</div>
          ${config.branding.showSignature && company.signatureUrl ? `<img src="${esc(company.signatureUrl)}" alt="">` : ''}
          ${config.branding.showStamp && company.stampUrl ? `<img src="${esc(company.stampUrl)}" alt="">` : ''}
        </div>
      </div>`
      : '';

  return `
    <div class="footer-blocks">
      ${blocks.length > 0 ? `<div class="footer-grid">${blocks.join('')}</div>` : ''}
      ${signatures}
      ${content.showLegalMentions && content.legalMentions ? `<div class="legal-mentions">${escMultiline(content.legalMentions)}</div>` : ''}
      ${content.footerText ? `<div class="custom-footer">${escMultiline(content.footerText)}</div>` : ''}
    </div>`;
}

function renderPreviewFooter(
  config: TemplateConfigBody,
  f: Formatters,
  pageCount: number,
): string {
  if (!config.pagination.showPageNumbers) return '';
  const label =
    config.pagination.pageNumberFormat === 'X_ONLY'
      ? f.t('page.x', { x: 1 })
      : config.pagination.pageNumberFormat === 'X_SLASH_Y'
        ? `${f.t('page.x', { x: 1 })} / ${pageCount}`
        : f.t('page.xOfY', { x: 1, y: pageCount });
  return `<div class="preview-footer">${esc(label)}</div>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a complete, self-contained HTML document.
 *
 * The same string is injected into an iframe for the configurator's live
 * preview and loaded into headless Chromium to produce the PDF. One code path
 * means the preview cannot drift from the printed result.
 */
export function renderDocumentHtml(
  data: RenderData,
  config: TemplateConfigBody,
  locale: Locale,
  options: RenderOptions = {},
): string {
  const f = buildFormatters(config, locale, data.document.currency);
  const direction = f.isRtl ? 'rtl' : directionFor(locale);
  const lang = locale.toLowerCase();
  const pageCount = options.estimatedPageCount ?? estimatePageCount(data, config);

  const googleFonts = options.fontCss
    ? ''
    : `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="${esc(googleFontsHref(config, locale))}">`;

  return `<!doctype html>
<html lang="${esc(lang)}" dir="${direction}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(f.t(`doc.${data.document.type}` as MessageKey))} ${esc(data.document.number ?? '')}</title>
${googleFonts}
<style>${options.fontCss ?? ''}
${buildCss(config, locale, options.forPdf ?? false)}</style>
</head>
<body>
${data.watermark ? `<div class="watermark"><span>${esc(data.watermark)}</span></div>` : ''}
<div class="sheet">
${renderHeader(data, config, f)}
${renderTitleRow(data, f)}
${renderParties(data, config, f)}
${renderLines(data, config, f)}
${renderTotals(data, config, f, locale)}
${renderFooterBlocks(data, config, f)}
${options.forPdf ? '' : renderPreviewFooter(config, f, pageCount)}
</div>
</body>
</html>`;
}

function googleFontsHref(config: TemplateConfigBody, locale: Locale): string {
  const families = new Set<string>([config.typography.headingFont, config.typography.bodyFont]);
  if (locale === 'AR') families.add('NotoNaskhArabic');

  const names: Record<string, string> = {
    Inter: 'Inter:wght@400;500;600;700;800',
    Roboto: 'Roboto:wght@400;500;700',
    Lato: 'Lato:wght@400;700;900',
    Merriweather: 'Merriweather:wght@400;700',
    NotoNaskhArabic: 'Noto+Naskh+Arabic:wght@400;500;600;700',
  };

  const query = [...families]
    .map((family) => `family=${names[family] ?? names.Inter}`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${query}&display=swap`;
}

/**
 * Chromium header/footer templates, used with `displayHeaderFooter`.
 *
 * `pageNumber` and `totalPages` are substituted by the browser, which is the
 * only way to get a truthful "Page X of Y" — the body cannot know how many
 * pages it became.
 */
export function renderPdfFooterTemplate(config: TemplateConfigBody, locale: Locale): string {
  if (!config.pagination.showPageNumbers) return '<span></span>';

  const f = buildFormatters(config, locale, config.localeOptions.currency);
  const direction = f.isRtl ? 'rtl' : 'ltr';
  const align =
    config.pagination.pageNumberPosition === 'FOOTER_LEFT'
      ? 'flex-start'
      : config.pagination.pageNumberPosition === 'FOOTER_RIGHT'
        ? 'flex-end'
        : 'center';

  const template =
    config.pagination.pageNumberFormat === 'X_ONLY'
      ? f.t('page.x', { x: '%%PAGE%%' })
      : config.pagination.pageNumberFormat === 'X_SLASH_Y'
        ? `%%PAGE%% / %%TOTAL%%`
        : f.t('page.xOfY', { x: '%%PAGE%%', y: '%%TOTAL%%' });

  // Chromium collapses ordinary spaces in header/footer templates, which turns
  // "Page 1 of 3" into "Page1of3"; non-breaking spaces survive.
  const body = esc(template)
    .replace(/ /g, '&nbsp;')
    .replace('%%PAGE%%', '<span class="pageNumber"></span>')
    .replace('%%TOTAL%%', '<span class="totalPages"></span>');

  return `<div style="-webkit-print-color-adjust:exact;width:100%;font-size:8pt;color:${config.colors.mutedText};font-family:sans-serif;direction:${direction};display:flex;justify-content:${align};padding:0 ${config.layout.marginRightMm}mm;">${body}</div>`;
}

export function renderPdfHeaderTemplate(): string {
  // The company block is part of the body so it participates in pagination;
  // Chromium's header band stays empty.
  return '<span></span>';
}

/**
 * Rough page count, for the preview footer and the configurator's hint.
 *
 * An iframe cannot paginate, so this estimates from the usable page height and
 * a measured average row height. It is a label, never a layout decision.
 */
export function estimatePageCount(data: RenderData, config: TemplateConfigBody): number {
  const page = pageDimensions(config);
  const usableHeightMm =
    page.height - config.layout.marginTopMm - config.layout.marginBottomMm;

  const headerMm = 46;
  const totalsMm = config.content.showVatSummaryTable ? 48 : 36;
  const footerMm =
    (config.content.showTermsAndConditions ? 16 : 0) +
    (config.content.showSignatureZones ? 28 : 0) +
    (config.content.showBankDetails ? 12 : 0);

  const rowMm = config.columns.showImage ? 14 : 6.5;
  const linesHeightMm = data.document.lines.length * rowMm + 8;

  const firstPageCapacity = usableHeightMm - headerMm;
  if (linesHeightMm + totalsMm + footerMm <= firstPageCapacity) return 1;

  const remaining = linesHeightMm - firstPageCapacity;
  const laterCapacity = usableHeightMm - 10;
  const extraPages = Math.ceil(Math.max(remaining, 0) / laterCapacity);

  // The totals block never splits from the table, so it may push a page on its own.
  const tail = totalsMm + footerMm;
  const tailFits = (linesHeightMm % laterCapacity || laterCapacity) + tail <= laterCapacity;

  return 1 + extraPages + (tailFits ? 0 : 1);
}
