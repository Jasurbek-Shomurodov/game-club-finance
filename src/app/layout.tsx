import type { Metadata, Viewport } from 'next';
import { Onest } from 'next/font/google';
import './globals.css';
import { getLocale, getMessages } from 'next-intl/server';
import { cookies } from 'next/headers';
import { AppIntlProvider } from '@/components/i18n/AppIntlProvider';
import { AppThemeProvider } from '@/components/theme/AppThemeContext';
import { THEME_COOKIE, parseAppTheme, themeAttribute } from '@/lib/theme';

// Cyrillic-first geometric sans; the variable font covers every weight used.
const onest = Onest({ subsets: ['latin', 'cyrillic'], variable: '--font-sans', display: 'swap' });
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : null;

export const metadata: Metadata = {
  title: 'Game Club Finance',
  description: 'Finance & Accounting for Game Club',
  // Public pages replace this with the club's own logo.
  icons: { icon: '/default-club.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets env(safe-area-inset-*) pad the top bar, sheets and toasts on notched phones.
  viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#ffffff' }, { media: '(prefers-color-scheme: dark)', color: '#101412' }],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [locale, messages, cookieStore] = await Promise.all([getLocale(), getMessages(), cookies()]);
  const theme = parseAppTheme(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <html lang={locale} data-theme={themeAttribute(theme)}>
      {supabaseOrigin ? (
        <head>
          <link rel="dns-prefetch" href={supabaseOrigin} />
          <link rel="preconnect" href={supabaseOrigin} crossOrigin="anonymous" />
        </head>
      ) : null}
      <body className={`${onest.variable} font-sans`}>
        <AppThemeProvider initialTheme={theme}>
          <AppIntlProvider initialLocale={locale} initialMessages={messages}>
            {children}
          </AppIntlProvider>
        </AppThemeProvider>
      </body>
    </html>
  );
}
