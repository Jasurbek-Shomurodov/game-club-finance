import type { Metadata } from 'next';

/**
 * What makes the admin app installable on a phone's home screen ("Add to Home
 * Screen" / "Install app"): the web manifest, the iOS equivalents and the
 * icons. Exported by the signed-in and sign-in layouts only: the public club
 * pages are a website, not this app, and keep the club's own logo.
 *
 * There is deliberately no service worker: nothing is cached for offline use,
 * so an installed app always shows live figures, exactly like the browser tab.
 */
export const APP_INSTALL_METADATA: Metadata = {
  manifest: '/admin.webmanifest',
  appleWebApp: { capable: true, title: 'Club Finance', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/icons/app-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/app-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};
