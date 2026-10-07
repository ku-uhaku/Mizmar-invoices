import type { Metadata } from 'next';
import { Inter, Noto_Sans_Arabic } from 'next/font/google';
import { directionFor } from '@mizmar/i18n';
import { I18nProvider } from '@/lib/i18n/provider';
import { getLocale } from '@/lib/i18n/server';
import { Providers } from '@/lib/providers';
import './globals.css';

const arabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
});

const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter', display: 'swap' });

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
      className={`${inter.variable} ${arabic.variable}`}
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
