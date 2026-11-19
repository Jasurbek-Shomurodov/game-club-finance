/** Route that serves a showcase logo as a round tab icon (see src/app/api/logo-icon). */
export const LOGO_ICON_PATH = '/api/logo-icon';

/**
 * Whether `url` is a logo in the public showcase storage bucket, the only
 * images the tab-icon route will fetch and redraw.
 */
export function isShowcaseLogoUrl(url: string, supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false;
  try {
    const parsed = new URL(url);
    const prefix = `${new URL(supabaseUrl).origin}/storage/v1/object/public/showcase/`;
    return parsed.protocol === 'https:' && `${parsed.origin}${parsed.pathname}`.startsWith(prefix) && !parsed.pathname.includes('..');
  } catch {
    return false;
  }
}
