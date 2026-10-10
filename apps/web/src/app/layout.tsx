import type { Metadata } from 'next';
import { Cairo, Fraunces, Plus_Jakarta_Sans } from 'next/font/google';
import { directionFor } from '@mizmar/i18n';
import { I18nProvider } from '@/lib/i18n/provider';
import { getLocale } from '@/lib/i18n/server';
import { Providers } from '@/lib/providers';
import './globals.css';

// Body: a friendly geometric sans. Headings: a soft serif with warmth. Arabic uses
// Cairo, whose geometric forms sit well beside Jakarta and which also covers Latin.
const arabic = Cairo({ subsets: ['arabic', 'latin'], variable: '--font-arabic', display: 'swap' });
const body = Plus_Jakarta_Sans({ subsets: ['latin', 'latin-ext'], variable: '--font-body', display: 'swap' });
const display = Fraunces({ subsets: ['latin', 'latin-ext'], variable: '--font-display-face', display: 'swap' });

export const metadata: Metadata = {
  title: 'Mizmar',
  description: 'Invoicing, stock and commercial documents',
};

// Runs before first paint so a saved theme never flashes the wrong palette.
const THEME_INIT = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html
      lang={locale.toLowerCase()}
      dir={directionFor(locale)}
      className={`${body.variable} ${display.variable} ${arabic.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen antialiased">
        <I18nProvider locale={locale}>
          <Providers>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
