import { describe, expect, it } from 'vitest';
import { renderDocumentHtml, renderPdfFooterTemplate, estimatePageCount, esc } from './render';
import { DEFAULT_TEMPLATE_CONFIG, withDefaults } from './defaults';
import { SAMPLE_DOCUMENT, sampleWithLineCount } from './sample';
import type { TemplateConfigBody } from './types';

const config = (overrides: Record<string, unknown> = {}): TemplateConfigBody =>
  withDefaults({ ...DEFAULT_TEMPLATE_CONFIG, ...overrides });

describe('esc', () => {
  it('escapes everything that could break out of an attribute or element', () => {
    expect(esc(`<script>alert("x") & 'y'</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
    );
  });

  it('renders null and undefined as empty, not as the words', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

describe('renderDocumentHtml — structure', () => {
  const html = renderDocumentHtml(SAMPLE_DOCUMENT, DEFAULT_TEMPLATE_CONFIG, 'FR');

  it('is a complete standalone document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('</html>');
  });

  it('inlines its stylesheet, so the PDF needs no network for layout', () => {
    expect(html).toContain('<style>');
    expect(html).toContain('@page');
  });

  it('prints the document title and number in the chosen language', () => {
    expect(html).toContain('Facture');
    expect(html).toContain('FA-2026-0042');
  });

  it('prints the company legal identity Morocco requires', () => {
    // Identifiers are bidi-isolated so they keep their order in an Arabic document.
    expect(html).toContain('002345678000091'); // ICE
    expect(html).toContain('RC: <bdi>123456</bdi>');
    expect(html).toContain('IF: <bdi>40123456</bdi>');
    expect(html).toContain('Patente: <bdi>35678901</bdi>');
  });

  it('prints the client and a distinct shipping address', () => {
    expect(html).toContain('ATLAS DISTRIBUTION SA');
    expect(html).toContain('Plateforme logistique, Hall 3');
    expect(html).toContain('Livrer à');
  });

  it('renders a section heading as a spanning row, not a row of blanks', () => {
    expect(html).toContain('class="note-row"');
    expect(html).toMatch(/<td colspan="\d+">Textile/);
  });

  it('formats money with the French separators and the dirham symbol', () => {
    expect(html).toContain('16 341,00 DH');
  });

  it('prints the VAT breakdown per rate', () => {
    expect(html).toContain('Récapitulatif TVA');
    expect(html).toContain('2 475,00');
    expect(html).toContain('120,00');
  });

  it('prints the amount in words, which Moroccan invoices require', () => {
    expect(html).toContain('Arrêtée la présente à la somme de');
    expect(html).toContain('Seize mille trois cent quarante et un dirhams');
  });

  it('shows the balance due once something has been paid', () => {
    expect(html).toContain('Reste à payer');
    expect(html).toContain('9 622,00');
  });
});

describe('renderDocumentHtml — content toggles', () => {
  it('hides SKUs when switched off', () => {
    const on = renderDocumentHtml(SAMPLE_DOCUMENT, config(), 'FR');
    const off = renderDocumentHtml(
      SAMPLE_DOCUMENT,
      config({ columns: { ...DEFAULT_TEMPLATE_CONFIG.columns, showSku: false } }),
      'FR',
    );
    expect(on).toContain('POLO-ROU-L');
    expect(off).not.toContain('POLO-ROU-L');
  });

  it('adds the BL reference column for a consolidated invoice', () => {
    const off = renderDocumentHtml(SAMPLE_DOCUMENT, config(), 'FR');
    const on = renderDocumentHtml(
      SAMPLE_DOCUMENT,
      config({ columns: { ...DEFAULT_TEMPLATE_CONFIG.columns, showSourceReference: true } }),
      'FR',
    );
    expect(off).not.toContain('Réf. BL');
    expect(on).toContain('Réf. BL');
    expect(on).toContain('BL-2026-0118');
  });

  it('can show VAT per line instead of only in the summary', () => {
    const html = renderDocumentHtml(
      SAMPLE_DOCUMENT,
      config({ columns: { ...DEFAULT_TEMPLATE_CONFIG.columns, showVatPerLine: true } }),
      'FR',
    );
    expect(html).toContain('>TVA</th>');
  });

  it('drops the amount in words when switched off', () => {
    const html = renderDocumentHtml(
      SAMPLE_DOCUMENT,
      config({ content: { ...DEFAULT_TEMPLATE_CONFIG.content, showAmountInWords: false } }),
      'FR',
    );
    expect(html).not.toContain('Arrêtée la présente');
  });

  it('drops the VAT summary table when switched off', () => {
    const html = renderDocumentHtml(
      SAMPLE_DOCUMENT,
      config({ content: { ...DEFAULT_TEMPLATE_CONFIG.content, showVatSummaryTable: false } }),
      'FR',
    );
    expect(html).not.toContain('Récapitulatif TVA');
  });

  it('renders signature zones and a custom footer on request', () => {
    const html = renderDocumentHtml(
      SAMPLE_DOCUMENT,
      config({
        content: {
          ...DEFAULT_TEMPLATE_CONFIG.content,
          showSignatureZones: true,
          footerText: 'Merci de votre confiance',
          legalMentions: 'Pénalités de retard: 1% par mois.',
        },
      }),
      'FR',
    );
    expect(html).toContain('Signature du client');
    expect(html).toContain('Merci de votre confiance');
    expect(html).toContain('Pénalités de retard');
  });

  it('applies the colour picker to the CSS tokens', () => {
    const html = renderDocumentHtml(
      SAMPLE_DOCUMENT,
      config({ colors: { ...DEFAULT_TEMPLATE_CONFIG.colors, primary: '#A21CAF' } }),
      'FR',
    );
    expect(html).toContain('--c-primary: #A21CAF');
  });

  it('applies the font and size pickers', () => {
    const html = renderDocumentHtml(
      SAMPLE_DOCUMENT,
      config({
        typography: { ...DEFAULT_TEMPLATE_CONFIG.typography, bodyFont: 'Merriweather', baseSizePt: 11 },
      }),
      'FR',
    );
    expect(html).toContain('Merriweather');
    expect(html).toContain('--fs-base: 11pt');
  });
});

describe('renderDocumentHtml — localisation', () => {
  it('pins amounts to left-to-right order even in an Arabic document', () => {
    const html = renderDocumentHtml(SAMPLE_DOCUMENT, DEFAULT_TEMPLATE_CONFIG, 'AR');
    // Without this the bidi algorithm renders "1 490,00 DH" as "DH 490,00 1".
    expect(html).toContain('<span dir="ltr">16 341,00 DH</span>');
  });

  it('isolates Latin addresses so their words are not resequenced', () => {
    const html = renderDocumentHtml(SAMPLE_DOCUMENT, DEFAULT_TEMPLATE_CONFIG, 'AR');
    expect(html).toContain('<bdi>12 Rue Ibn Batouta</bdi>');
  });

  it('mirrors the layout for Arabic', () => {
    const html = renderDocumentHtml(SAMPLE_DOCUMENT, DEFAULT_TEMPLATE_CONFIG, 'AR');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain('فاتورة');
    // Column alignment flips, not just the text direction.
    expect(html).toContain('text-align: right');
  });

  it('appends an Arabic face so mixed content still renders', () => {
    const html = renderDocumentHtml(SAMPLE_DOCUMENT, DEFAULT_TEMPLATE_CONFIG, 'AR');
    expect(html).toContain('Noto Naskh Arabic');
  });

  it('renders English with LTR and English labels', () => {
    const html = renderDocumentHtml(SAMPLE_DOCUMENT, DEFAULT_TEMPLATE_CONFIG, 'EN');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('>Invoice<');
    expect(html).toContain('Amount in words');
  });

  it('honours the separator and date-format settings', () => {
    const html = renderDocumentHtml(
      SAMPLE_DOCUMENT,
      config({
        localeOptions: {
          ...DEFAULT_TEMPLATE_CONFIG.localeOptions,
          decimalSeparator: '.',
          thousandsSeparator: ',',
          dateFormat: 'YYYY-MM-DD',
          currencySymbolPosition: 'BEFORE',
        },
      }),
      'EN',
    );
    expect(html).toContain('DH 16,341.00');
    expect(html).toContain('2026-10-06');
  });

  it('can print Arabic-Indic digits', () => {
    const html = renderDocumentHtml(
      SAMPLE_DOCUMENT,
      config({
        localeOptions: { ...DEFAULT_TEMPLATE_CONFIG.localeOptions, useArabicIndicDigits: true },
      }),
      'AR',
    );
    expect(html).toMatch(/[٠-٩]/);
  });
});

describe('renderDocumentHtml — pagination rules', () => {
  it('repeats the table header across pages by default', () => {
    const html = renderDocumentHtml(SAMPLE_DOCUMENT, DEFAULT_TEMPLATE_CONFIG, 'FR');
    expect(html).toContain('table.lines thead { display: table-header-group; }');
  });

  it('stops repeating it when switched off', () => {
    const html = renderDocumentHtml(
      SAMPLE_DOCUMENT,
      config({ pagination: { ...DEFAULT_TEMPLATE_CONFIG.pagination, repeatTableHeader: false } }),
      'FR',
    );
    expect(html).toContain('table.lines thead { display: table-row-group; }');
  });

  it('keeps line rows unbroken', () => {
    const html = renderDocumentHtml(SAMPLE_DOCUMENT, DEFAULT_TEMPLATE_CONFIG, 'FR');
    expect(html).toContain('page-break-inside: avoid');
  });

  it('pins the totals block to the table it totals', () => {
    const html = renderDocumentHtml(SAMPLE_DOCUMENT, DEFAULT_TEMPLATE_CONFIG, 'FR');
    expect(html).toContain('page-break-before: avoid');
  });

  it('sets the page size and margins from the layout settings', () => {
    const html = renderDocumentHtml(
      SAMPLE_DOCUMENT,
      config({ layout: { ...DEFAULT_TEMPLATE_CONFIG.layout, pageSize: 'LETTER', marginTopMm: 20 } }),
      'FR',
    );
    expect(html).toContain('size: 215.9mm 279.4mm');
    expect(html).toContain('margin: 20mm');
  });

  it('swaps width and height for landscape', () => {
    const html = renderDocumentHtml(
      SAMPLE_DOCUMENT,
      config({ layout: { ...DEFAULT_TEMPLATE_CONFIG.layout, orientation: 'LANDSCAPE' } }),
      'FR',
    );
    expect(html).toContain('size: 297mm 210mm');
  });
});

describe('renderPdfFooterTemplate', () => {
  it('uses Chromium placeholders, the only truthful source of Y', () => {
    const footer = renderPdfFooterTemplate(DEFAULT_TEMPLATE_CONFIG, 'FR');
    expect(footer).toContain('<span class="pageNumber"></span>');
    expect(footer).toContain('<span class="totalPages"></span>');
    expect(footer).toContain('Page');
  });

  it('uses non-breaking spaces, which Chromium does not collapse', () => {
    // A plain space here renders as "Page1sur1".
    const footer = renderPdfFooterTemplate(DEFAULT_TEMPLATE_CONFIG, 'FR');
    expect(footer).toContain('Page&nbsp;<span class="pageNumber"></span>&nbsp;sur&nbsp;');
  });

  it('respects the X / Y format', () => {
    const footer = renderPdfFooterTemplate(
      withDefaults({
        ...DEFAULT_TEMPLATE_CONFIG,
        pagination: { ...DEFAULT_TEMPLATE_CONFIG.pagination, pageNumberFormat: 'X_SLASH_Y' },
      }),
      'FR',
    );
    expect(footer).toContain('/');
    expect(footer).not.toContain('sur');
  });

  it('renders nothing when page numbers are off', () => {
    const footer = renderPdfFooterTemplate(
      withDefaults({
        ...DEFAULT_TEMPLATE_CONFIG,
        pagination: { ...DEFAULT_TEMPLATE_CONFIG.pagination, showPageNumbers: false },
      }),
      'FR',
    );
    expect(footer).toBe('<span></span>');
  });

  it('flips direction for Arabic', () => {
    expect(renderPdfFooterTemplate(DEFAULT_TEMPLATE_CONFIG, 'AR')).toContain('direction:rtl');
  });
});

describe('estimatePageCount', () => {
  it('fits a short document on one page', () => {
    expect(estimatePageCount(SAMPLE_DOCUMENT, DEFAULT_TEMPLATE_CONFIG)).toBe(1);
  });

  it('grows with the line count', () => {
    const short = estimatePageCount(sampleWithLineCount(10), DEFAULT_TEMPLATE_CONFIG);
    const long = estimatePageCount(sampleWithLineCount(120), DEFAULT_TEMPLATE_CONFIG);
    expect(long).toBeGreaterThan(short);
  });

  it('needs more pages when every line carries an image', () => {
    const withImages = config({
      columns: { ...DEFAULT_TEMPLATE_CONFIG.columns, showImage: true },
    });
    expect(estimatePageCount(sampleWithLineCount(60), withImages)).toBeGreaterThan(
      estimatePageCount(sampleWithLineCount(60), DEFAULT_TEMPLATE_CONFIG),
    );
  });
});

describe('renderDocumentHtml — safety', () => {
  it('escapes user-entered content rather than injecting it', () => {
    const hostile = {
      ...SAMPLE_DOCUMENT,
      contact: { ...SAMPLE_DOCUMENT.contact, legalName: '<script>steal()</script>' },
      document: { ...SAMPLE_DOCUMENT.document, notes: '"><img src=x onerror=alert(1)>' },
    };
    const html = renderDocumentHtml(hostile, DEFAULT_TEMPLATE_CONFIG, 'FR');
    // The payload must survive as inert text: no tag is formed, so the
    // attribute never reaches the parser even though the words are present.
    expect(html).not.toContain('<script>steal()');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;steal()');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('turns newlines in prose into line breaks', () => {
    const html = renderDocumentHtml(
      { ...SAMPLE_DOCUMENT, document: { ...SAMPLE_DOCUMENT.document, notes: 'line one\nline two' } },
      DEFAULT_TEMPLATE_CONFIG,
      'FR',
    );
    expect(html).toContain('line one<br>line two');
  });
});
