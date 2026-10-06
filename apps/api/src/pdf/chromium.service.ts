import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import type { Env } from '../config/env';
import { AppError } from '../common/app-error';

/** Where a Chromium binary usually lives, in rough order of preference. */
const CANDIDATE_PATHS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/**
 * Owns the one long-lived headless browser.
 *
 * Launching Chromium costs a few hundred milliseconds, so a browser per render
 * would make a four-page invoice feel slow. One browser is kept alive and each
 * render gets its own context, which is cheap and keeps renders isolated.
 */
@Injectable()
export class ChromiumService implements OnModuleDestroy {
  private readonly logger = new Logger(ChromiumService.name);
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }

  executablePath(): string | null {
    const configured = this.config.get('CHROMIUM_PATH', { infer: true });
    if (configured) return existsSync(configured) ? configured : null;
    return CANDIDATE_PATHS.find((candidate) => existsSync(candidate)) ?? null;
  }

  isAvailable(): boolean {
    return this.executablePath() !== null;
  }

  /**
   * Render HTML to PDF bytes.
   *
   * `printBackground` is on because the whole point of the style configurator
   * is coloured table headers and totals blocks, which Chromium drops by
   * default. Header and footer bands are declared here rather than in the body,
   * because only the browser knows the real page count.
   */
  async renderPdf(
    html: string,
    options: {
      headerTemplate: string;
      footerTemplate: string;
      marginTopMm: number;
      marginRightMm: number;
      marginBottomMm: number;
      marginLeftMm: number;
      landscape: boolean;
      pageSize: 'A4' | 'LETTER';
    },
  ): Promise<Buffer> {
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      // A fixed viewport and scale keep the PDF identical across machines.
      viewport: { width: 1240, height: 1754 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });

    try {
      const page = await context.newPage();
      const timeout = this.config.get('PDF_RENDER_TIMEOUT_MS', { infer: true });

      await page.setContent(html, { waitUntil: 'load', timeout });
      // Webfonts must be settled before layout is measured, or the first page
      // break lands in a different place than the preview showed.
      // Passed as a string because this expression runs in the page, not in
      // Node, so the DOM lib is deliberately absent from this project's types.
      await page.evaluate('document.fonts && document.fonts.ready').catch(() => undefined);
      await page.emulateMedia({ media: 'print' });

      const pdf = await page.pdf({
        format: options.pageSize === 'LETTER' ? 'Letter' : 'A4',
        landscape: options.landscape,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: options.headerTemplate,
        footerTemplate: options.footerTemplate,
        margin: {
          top: `${options.marginTopMm}mm`,
          right: `${options.marginRightMm}mm`,
          bottom: `${options.marginBottomMm}mm`,
          left: `${options.marginLeftMm}mm`,
        },
        preferCSSPageSize: false,
      });

      return pdf;
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    // Collapse concurrent first-renders onto one launch.
    this.launching ??= this.launch();
    try {
      this.browser = await this.launching;
      return this.browser;
    } finally {
      this.launching = null;
    }
  }

  private async launch(): Promise<Browser> {
    const executablePath = this.executablePath();
    if (!executablePath) {
      throw AppError.unprocessable(
        'PDF_ENGINE_UNAVAILABLE',
        'No Chromium or Chrome binary was found. Set CHROMIUM_PATH to enable PDF rendering.',
      );
    }

    this.logger.log(`Launching headless browser: ${executablePath}`);
    return chromium.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    });
  }
}
