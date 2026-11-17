import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { APP_INSTALL_METADATA } from './appInstall';
import { config } from '@/proxy';

const publicDir = resolve(process.cwd(), 'public');
const manifest = JSON.parse(readFileSync(resolve(publicDir, 'admin.webmanifest'), 'utf8')) as {
  start_url: string; scope: string; display: string; name: string; short_name: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
  shortcuts: Array<{ name: string; url: string }>;
};

describe('installable admin app', () => {
  it('opens on the dashboard as a standalone app', () => {
    expect(manifest).toMatchObject({ start_url: '/dashboard', scope: '/', display: 'standalone' });
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toEqual(['/daily-cash', '/closing-stock', '/reports']);
  });

  it('ships every icon the manifest and the page name, at the size they claim', async () => {
    const pageIcons = [APP_INSTALL_METADATA.icons].flatMap((icons) => {
      const set = icons as { icon: Array<{ url: string; sizes: string }>; apple: Array<{ url: string; sizes: string }> };
      return [...set.icon, ...set.apple].map((icon) => ({ src: icon.url, sizes: icon.sizes }));
    });
    for (const icon of [...manifest.icons, ...pageIcons]) {
      const [width, height] = icon.sizes.split('x').map(Number);
      const meta = await sharp(resolve(publicDir, `.${icon.src}`)).metadata();
      expect({ src: icon.src, width: meta.width, height: meta.height, format: meta.format })
        .toEqual({ src: icon.src, width, height, format: 'png' });
    }
    // Android needs a 192 and a 512, and a maskable one to fill its icon shapes.
    expect(manifest.icons.map((icon) => `${icon.sizes}:${icon.purpose}`).sort())
      .toEqual(['192x192:any', '512x512:any', '512x512:maskable']);
  });

  it('is linked from the app pages and reaches the browser without a session', () => {
    expect(APP_INSTALL_METADATA.manifest).toBe('/admin.webmanifest');
    // Browsers fetch the manifest and its icons without cookies: the proxy must not send them to /login.
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ['/admin.webmanifest', ...manifest.icons.map((icon) => icon.src)]) {
      expect(matcher.test(path), path).toBe(false);
    }
    expect(matcher.test('/dashboard')).toBe(true);
  });
});
