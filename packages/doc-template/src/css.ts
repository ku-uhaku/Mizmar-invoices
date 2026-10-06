import type { Locale, TemplateConfigBody } from './types';

const FONT_STACKS: Record<string, string> = {
  Inter: `'Inter', 'Helvetica Neue', Arial, sans-serif`,
  Roboto: `'Roboto', 'Helvetica Neue', Arial, sans-serif`,
  Lato: `'Lato', 'Helvetica Neue', Arial, sans-serif`,
  Merriweather: `'Merriweather', Georgia, 'Times New Roman', serif`,
  NotoNaskhArabic: `'Noto Naskh Arabic', 'Amiri', 'Traditional Arabic', serif`,
};

/**
 * Arabic text needs an Arabic face appended to whatever Latin family was
 * chosen, so mixed content (a French product name in an Arabic invoice) still
 * renders rather than falling back to boxes.
 */
function fontStack(family: string, locale: Locale): string {
  const base = FONT_STACKS[family] ?? FONT_STACKS.Inter!;
  return locale === 'AR' ? `${FONT_STACKS.NotoNaskhArabic}, ${base}` : base;
}

const PAGE_SIZES = {
  A4: { width: 210, height: 297 },
  LETTER: { width: 215.9, height: 279.4 },
} as const;

export function pageDimensions(config: TemplateConfigBody): { width: number; height: number } {
  const size = PAGE_SIZES[config.layout.pageSize];
  return config.layout.orientation === 'LANDSCAPE'
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

/**
 * The stylesheet, driven entirely by the config object.
 *
 * Every tunable is a CSS custom property on `:root`, so the configurator's live
 * preview and the server's PDF are styled by the same declarations — which is
 * what makes the preview honestly WYSIWYG rather than an approximation.
 */
export function buildCss(config: TemplateConfigBody, locale: Locale, forPdf: boolean): string {
  const { colors, typography, layout, pagination, columns } = config;
  const page = pageDimensions(config);
  const isRtl =
    config.localeOptions.direction === 'RTL' ||
    (config.localeOptions.direction === 'AUTO' && locale === 'AR');

  // Logical properties would be cleaner, but print engines still disagree on
  // them, so the start/end edges are resolved here instead.
  const startEdge = isRtl ? 'right' : 'left';
  const endEdge = isRtl ? 'left' : 'right';

  return `
:root {
  --c-primary: ${colors.primary};
  --c-accent: ${colors.accent};
  --c-text: ${colors.text};
  --c-muted: ${colors.mutedText};
  --c-border: ${colors.border};
  --c-thead-bg: ${colors.tableHeaderBackground};
  --c-thead-text: ${colors.tableHeaderText};
  --c-zebra: ${colors.zebraStriping ? colors.zebraBackground : 'transparent'};
  --c-totals-bg: ${colors.totalsBackground};

  --font-heading: ${fontStack(typography.headingFont, locale)};
  --font-body: ${fontStack(typography.bodyFont, locale)};
  --fs-base: ${typography.baseSizePt}pt;
  --lh: ${typography.lineHeight};
  --fs-title: calc(var(--fs-base) * ${typography.headingScale});

  --radius: ${layout.cornerRadiusPx}px;
  --gap: 4mm;
  --desc-width: ${columns.descriptionWidthPercent}%;
}

@page {
  size: ${page.width}mm ${page.height}mm;
  margin: ${layout.marginTopMm}mm ${layout.marginRightMm}mm ${layout.marginBottomMm}mm ${layout.marginLeftMm}mm;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  font-family: var(--font-body);
  font-size: var(--fs-base);
  line-height: var(--lh);
  color: var(--c-text);
  background: #ffffff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/*
 * On screen the sheet is a visible page with the configured margins so the
 * preview is to scale. In print the @page margins apply instead, and the sheet
 * must not add its own or content shifts between preview and PDF.
 */
.sheet {
  width: ${page.width}mm;
  min-height: ${page.height}mm;
  margin: 0 auto;
  padding: ${layout.marginTopMm}mm ${layout.marginRightMm}mm ${layout.marginBottomMm}mm ${layout.marginLeftMm}mm;
  background: #ffffff;
}

@media print {
  .sheet {
    width: auto;
    min-height: 0;
    margin: 0;
    padding: 0;
  }
  .preview-footer { display: none !important; }
}

/* ---------- Header ---------- */

.doc-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gap);
  padding-bottom: 3mm;
  border-bottom: 0.6mm solid var(--c-primary);
}
.doc-header.layout-center { flex-direction: column; align-items: center; text-align: center; }
.doc-header.layout-banner {
  background: var(--c-primary);
  color: ${colors.tableHeaderText};
  padding: 4mm;
  border-radius: var(--radius);
  border-bottom: 0;
}
.doc-header.layout-banner .company-name,
.doc-header.layout-banner .company-legal { color: ${colors.tableHeaderText}; }
.doc-header.layout-minimal { border-bottom: 0.2mm solid var(--c-border); }

.logo { max-width: ${config.branding.logoWidthMm}mm; max-height: 28mm; object-fit: contain; }
.logo-slot.pos-${config.branding.logoPosition.toLowerCase()} { text-align: ${
    config.branding.logoPosition === 'LEFT'
      ? startEdge
      : config.branding.logoPosition === 'RIGHT'
        ? endEdge
        : 'center'
  }; }

.company-block {
  font-size: calc(var(--fs-base) * 0.92);
  /* Flex items default to min-width:auto and refuse to shrink, which pushes the
     long Moroccan legal line off the page. */
  min-width: 0;
  overflow-wrap: anywhere;
}
.company-name {
  font-family: var(--font-heading);
  font-size: calc(var(--fs-base) * 1.3);
  font-weight: 700;
  color: var(--c-primary);
  margin: 0 0 1mm;
}
.company-legal { color: var(--c-muted); }
.company-legal { overflow-wrap: anywhere; }
.company-legal span { white-space: nowrap; }
.company-legal .sep { color: var(--c-border); white-space: normal; }

/* ---------- Title and meta ---------- */

.title-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--gap);
  margin: 5mm 0 3mm;
}
.doc-title {
  font-family: var(--font-heading);
  font-size: var(--fs-title);
  font-weight: 700;
  color: var(--c-primary);
  margin: 0;
  letter-spacing: 0.02em;
}
.doc-number { font-size: calc(var(--fs-base) * 1.05); font-weight: 600; margin-top: 1mm; }

.meta-table { border-collapse: collapse; font-size: calc(var(--fs-base) * 0.95); }
.meta-table th {
  text-align: ${startEdge};
  font-weight: 600;
  color: var(--c-muted);
  padding: 0.6mm 3mm 0.6mm 0;
  white-space: nowrap;
}
.meta-table td { padding: 0.6mm 0; font-weight: 600; }

/* ---------- Parties ---------- */

.parties { display: flex; gap: var(--gap); margin-bottom: 4mm; }
.party {
  flex: 1;
  border: 0.2mm solid var(--c-border);
  border-radius: var(--radius);
  padding: 3mm;
  min-width: 0;
}
.party-label {
  font-size: calc(var(--fs-base) * 0.8);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--c-accent);
  font-weight: 700;
  margin-bottom: 1.5mm;
}
.party-name { font-weight: 700; }
.party-line { color: var(--c-muted); }

/* ---------- Line items ---------- */

table.lines { width: 100%; border-collapse: collapse; font-size: calc(var(--fs-base) * 0.95); }
table.lines thead th {
  background: var(--c-thead-bg);
  color: var(--c-thead-text);
  font-weight: 600;
  text-align: ${startEdge};
  padding: 2mm 2mm;
  border: 0;
}
table.lines thead th.num { text-align: ${endEdge}; }
table.lines thead th:first-child { border-start-start-radius: var(--radius); }
table.lines thead th:last-child { border-start-end-radius: var(--radius); }

table.lines tbody td {
  padding: 1.8mm 2mm;
  border-bottom: 0.2mm solid var(--c-border);
  vertical-align: top;
}
table.lines tbody td.num { text-align: ${endEdge}; white-space: nowrap; font-variant-numeric: tabular-nums; }
/* Amounts read left-to-right in every language; only their alignment flips. */
td.num span[dir='ltr'], table.totals td span[dir='ltr'], table.vat-summary td span[dir='ltr'] {
  unicode-bidi: isolate;
}
table.lines tbody tr:nth-child(even) td { background: var(--c-zebra); }
table.lines tbody tr.note-row td {
  font-weight: 600;
  color: var(--c-accent);
  background: transparent;
  border-bottom: 0.2mm solid var(--c-border);
}
.col-desc { width: var(--desc-width); }
.line-desc { font-weight: 500; }
.line-variant { color: var(--c-muted); font-size: calc(var(--fs-base) * 0.88); }
.line-sku { color: var(--c-muted); font-size: calc(var(--fs-base) * 0.85); }
.line-image { width: 12mm; height: 12mm; object-fit: contain; }

/*
 * Pagination rules from the configurator.
 *
 * table-header-group repeats the column headers on every page -- without it a
 * three-page invoice has two pages of unlabelled numbers. break-inside keeps
 * a line's own rows together, and the totals block is pinned to the table it
 * totals so a reader never turns the page to find the amount due.
 */
${
  pagination.repeatTableHeader
    ? `table.lines thead { display: table-header-group; }`
    : `table.lines thead { display: table-row-group; }`
}
${
  pagination.keepLineGroupsTogether
    ? `table.lines tbody tr { break-inside: avoid; page-break-inside: avoid; }`
    : ''
}
table.lines tbody { break-before: auto; }

.totals-block {
  display: flex;
  gap: var(--gap);
  justify-content: space-between;
  margin-top: 4mm;
  ${pagination.keepTotalsWithTable ? 'break-before: avoid; page-break-before: avoid;' : ''}
  break-inside: avoid;
  page-break-inside: avoid;
}
.totals-left { flex: 1; min-width: 0; }
.totals-right { width: 72mm; flex: none; }

table.vat-summary { width: 100%; border-collapse: collapse; font-size: calc(var(--fs-base) * 0.88); }
table.vat-summary caption {
  text-align: ${startEdge};
  font-weight: 700;
  color: var(--c-muted);
  padding-bottom: 1mm;
  font-size: calc(var(--fs-base) * 0.85);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
table.vat-summary th, table.vat-summary td {
  border: 0.2mm solid var(--c-border);
  padding: 1.2mm 2mm;
  text-align: ${endEdge};
}
table.vat-summary th:first-child, table.vat-summary td:first-child { text-align: ${startEdge}; }

table.totals { width: 100%; border-collapse: collapse; }
table.totals th {
  text-align: ${startEdge};
  font-weight: 500;
  color: var(--c-muted);
  padding: 1.2mm 2mm;
}
table.totals td {
  text-align: ${endEdge};
  padding: 1.2mm 2mm;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
table.totals tr.grand th, table.totals tr.grand td {
  background: var(--c-primary);
  color: ${colors.tableHeaderText};
  font-weight: 700;
  font-size: calc(var(--fs-base) * 1.1);
}
table.totals tr.subtle th, table.totals tr.subtle td { background: var(--c-totals-bg); }
table.totals tr.due th, table.totals tr.due td {
  border-top: 0.4mm solid var(--c-primary);
  font-weight: 700;
}

.amount-in-words {
  margin-top: 3mm;
  padding: 2.5mm 3mm;
  background: var(--c-totals-bg);
  border-radius: var(--radius);
  break-inside: avoid;
}
.amount-in-words .label {
  font-size: calc(var(--fs-base) * 0.8);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--c-muted);
  font-weight: 700;
}
.amount-in-words .value { font-weight: 600; font-style: italic; }

/* ---------- Footer blocks ---------- */

.footer-blocks { margin-top: 5mm; break-inside: avoid; }
.footer-grid { display: flex; gap: var(--gap); }
.footer-block { flex: 1; min-width: 0; }
.footer-block h4 {
  margin: 0 0 1mm;
  font-size: calc(var(--fs-base) * 0.82);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--c-accent);
}
.footer-block p { margin: 0; white-space: pre-line; color: var(--c-muted); }
.bank-line { display: flex; gap: 2mm; }
.bank-line .k { color: var(--c-muted); min-width: 16mm; }
.bank-line .v { font-weight: 600; font-variant-numeric: tabular-nums; }

.signatures { display: flex; gap: var(--gap); margin-top: 6mm; break-inside: avoid; }
.signature-zone {
  flex: 1;
  border: 0.2mm dashed var(--c-border);
  border-radius: var(--radius);
  min-height: 24mm;
  padding: 2mm;
  position: relative;
}
.signature-zone .zone-label {
  font-size: calc(var(--fs-base) * 0.8);
  color: var(--c-muted);
  font-weight: 600;
}
.signature-zone img { max-height: 18mm; max-width: 100%; object-fit: contain; display: block; margin-top: 1mm; }

.legal-mentions {
  margin-top: 4mm;
  padding-top: 2mm;
  border-top: 0.2mm solid var(--c-border);
  font-size: calc(var(--fs-base) * 0.78);
  color: var(--c-muted);
  white-space: pre-line;
}
.custom-footer {
  margin-top: 2mm;
  font-size: calc(var(--fs-base) * 0.78);
  color: var(--c-muted);
  text-align: center;
  white-space: pre-line;
}

.preview-footer {
  margin-top: 3mm;
  padding-top: 1.5mm;
  border-top: 0.2mm solid var(--c-border);
  font-size: calc(var(--fs-base) * 0.78);
  color: var(--c-muted);
  text-align: ${
    pagination.pageNumberPosition === 'FOOTER_LEFT'
      ? startEdge
      : pagination.pageNumberPosition === 'FOOTER_RIGHT'
        ? endEdge
        : 'center'
  };
}

.watermark {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 10;
}
.watermark span {
  font-family: var(--font-heading);
  font-size: 56pt;
  font-weight: 800;
  color: ${colors.border};
  opacity: 0.45;
  transform: rotate(-32deg);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
${forPdf ? '.watermark { position: absolute; }' : ''}
`.trim();
}
