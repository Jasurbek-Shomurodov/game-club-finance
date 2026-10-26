import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }));

async function loadProxy() {
  vi.resetModules();
  vi.stubEnv('PUBLIC_SITE_HOSTS', 'pixelgaming.uz');
  vi.stubEnv('PUBLIC_SITE_BRAND_SLUG', 'pixel-gaming');
  vi.stubEnv('ADMIN_SITE_URL', 'https://admin.pixelgaming.uz');
  return (await import('./proxy')).proxy;
}

const request = (url: string) => new NextRequest(url);

describe('public site host in the proxy', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('rewrites the public root to the brand page without asking for login', async () => {
    const proxy = await loadProxy();
    const response = await proxy(request('https://pixelgaming.uz/'));
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://pixelgaming.uz/brand/pixel-gaming');
    expect(response.headers.get('location')).toBeNull();
  });

  it('sends the dashboard on the public host to the admin host', async () => {
    const proxy = await loadProxy();
    const response = await proxy(request('https://pixelgaming.uz/daily-cash'));
    expect(response.headers.get('location')).toBe('https://admin.pixelgaming.uz/daily-cash');
  });

  it('keeps the admin host behind login', async () => {
    const proxy = await loadProxy();
    const response = await proxy(request('https://admin.pixelgaming.uz/'));
    expect(response.headers.get('location')).toBe('https://admin.pixelgaming.uz/login');
  });
});
