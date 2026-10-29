import { describe, expect, it } from 'vitest';
import { normalizeHost, readPublicSiteConfig, routePublicSite } from './publicSite';

const config = readPublicSiteConfig({
  PUBLIC_SITE_HOSTS: 'pixelgaming.uz, WWW.pixelgaming.uz',
  PUBLIC_SITE_BRAND_SLUG: 'pixel-gaming',
  ADMIN_SITE_URL: 'https://admin.pixelgaming.uz/ignored-path',
});

describe('public site routing', () => {
  it('reads and normalizes the configuration', () => {
    expect(config).toEqual({ hosts: ['pixelgaming.uz', 'www.pixelgaming.uz'], brandSlug: 'pixel-gaming', adminUrl: 'https://admin.pixelgaming.uz' });
    expect(readPublicSiteConfig({ ADMIN_SITE_URL: 'javascript:alert(1)', PUBLIC_SITE_BRAND_SLUG: '../x' })).toEqual({ hosts: [], brandSlug: null, adminUrl: null });
    expect(normalizeHost('Pixelgaming.UZ:443')).toBe('pixelgaming.uz');
  });

  it('shows the brand page at the public root', () => {
    expect(routePublicSite('www.pixelgaming.uz', '/', '', config)).toEqual({ kind: 'rewrite', pathname: '/brand/pixel-gaming' });
  });

  it('serves club and brand pages on the public host', () => {
    expect(routePublicSite('pixelgaming.uz', '/club/chilonzor', '', config)).toEqual({ kind: 'pass' });
    expect(routePublicSite('pixelgaming.uz', '/brand/pixel-gaming', '', config)).toEqual({ kind: 'pass' });
    expect(routePublicSite('pixelgaming.uz', '/privacy', '', config)).toEqual({ kind: 'pass' });
    expect(routePublicSite('pixelgaming.uz', '/privacy-admin', '', config)).toMatchObject({ kind: 'redirect' });
  });

  it('sends admin paths on the public host to the admin host', () => {
    expect(routePublicSite('pixelgaming.uz', '/reports', '?month=2026-10', config))
      .toEqual({ kind: 'redirect', url: 'https://admin.pixelgaming.uz/reports?month=2026-10' });
    expect(routePublicSite('pixelgaming.uz', '/login', '', { ...config, adminUrl: null })).toEqual({ kind: 'redirect', url: '/' });
  });

  it('opens the dashboard at the admin host root', () => {
    expect(routePublicSite('Admin.pixelgaming.uz:443', '/', '', config)).toEqual({ kind: 'redirect', url: '/dashboard' });
    expect(routePublicSite('admin.pixelgaming.uz', '/', '', { ...config, adminUrl: null })).toBeNull();
  });

  it('leaves every other host to the admin app', () => {
    expect(routePublicSite('admin.pixelgaming.uz', '/login', '', config)).toBeNull();
    expect(routePublicSite('game-club-finance.vercel.app', '/', '', config)).toBeNull();
    expect(routePublicSite('game-club-finance.vercel.app', '/reports', '', config)).toBeNull();
    expect(routePublicSite('pixelgaming.uz', '/', '', readPublicSiteConfig({}))).toBeNull();
  });
});
