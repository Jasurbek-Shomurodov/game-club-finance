/**
 * Host-based split between the public site (pixelgaming.uz) and the admin app
 * (admin.pixelgaming.uz), both served by this one deployment. Configured with
 * server-only environment variables; with none set every host is the admin
 * app, exactly as before.
 *
 *   PUBLIC_SITE_HOSTS       comma-separated public hostnames, e.g. "pixelgaming.uz,www.pixelgaming.uz"
 *   PUBLIC_SITE_BRAND_SLUG  brand page shown at the public root, e.g. "pixel-gaming"
 *   ADMIN_SITE_URL          where admin paths on a public host are sent, e.g. "https://admin.pixelgaming.uz"
 */
export interface PublicSiteConfig {
  hosts: string[];
  brandSlug: string | null;
  adminUrl: string | null;
}

export type PublicSiteRoute =
  | { kind: 'rewrite'; pathname: string }
  | { kind: 'pass' }
  | { kind: 'redirect'; url: string };

export function readPublicSiteConfig(env: Record<string, string | undefined>): PublicSiteConfig {
  const hosts = (env.PUBLIC_SITE_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const slug = env.PUBLIC_SITE_BRAND_SLUG?.trim().toLowerCase();
  let adminUrl: string | null = null;
  try {
    const parsed = env.ADMIN_SITE_URL ? new URL(env.ADMIN_SITE_URL) : null;
    adminUrl = parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? parsed.origin : null;
  } catch {
    adminUrl = null;
  }
  return { hosts, brandSlug: slug && /^[a-z0-9-]+$/.test(slug) ? slug : null, adminUrl };
}

/** "Pixelgaming.uz:443" → "pixelgaming.uz". */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? '').trim().toLowerCase().replace(/:\d+$/, '');
}

const PUBLIC_PREFIXES = ['/club/', '/brand/'];

/**
 * What a public host does with a path: the root shows the brand page, club and
 * brand pages pass through, and every admin path goes to the admin host (or
 * the public root when no admin host is configured). Null for any other host.
 */
export function routePublicSite(host: string, pathname: string, search: string, config: PublicSiteConfig): PublicSiteRoute | null {
  if (!config.hosts.includes(normalizeHost(host))) return null;
  if (pathname === '/' && config.brandSlug) return { kind: 'rewrite', pathname: `/brand/${config.brandSlug}` };
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return { kind: 'pass' };
  if (pathname === '/') return { kind: 'pass' };
  return { kind: 'redirect', url: config.adminUrl ? `${config.adminUrl}${pathname}${search}` : '/' };
}
