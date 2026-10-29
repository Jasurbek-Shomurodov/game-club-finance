import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { safeRedirectPath } from './lib/validation';
import { PUBLIC_PAGES, readPublicSiteConfig, routePublicSite } from './lib/publicSite';
import { DASHBOARD_PATH } from '@/lib/routes';

const publicSite = readPublicSiteConfig(process.env);

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some(({ name, value }) => name.startsWith('sb-') && name.includes('-auth-token') && Boolean(value));
}

/** Sends an anonymous visitor to /login, remembering the page they asked for. */
function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL('/login', request.url);
  const next = safeRedirectPath(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (next && next !== '/' && next !== DASHBOARD_PATH) loginUrl.searchParams.set('next', next);
  return NextResponse.redirect(loginUrl);
}

export async function proxy(request: NextRequest) {
  // The public domain shows the brand and club pages only; see src/lib/publicSite.ts.
  const publicRoute = routePublicSite(request.headers.get('host') ?? request.nextUrl.host, request.nextUrl.pathname, request.nextUrl.search, publicSite);
  if (publicRoute?.kind === 'rewrite') {
    const url = request.nextUrl.clone();
    url.pathname = publicRoute.pathname;
    return NextResponse.rewrite(url);
  }
  if (publicRoute?.kind === 'pass') return NextResponse.next({ request });
  if (publicRoute?.kind === 'redirect') return NextResponse.redirect(new URL(publicRoute.url, request.url));

  // The landing page (/), published club and brand pages and the privacy
  // policy are public; they read only get_public_showcase / get_public_brand.
  if (
    request.nextUrl.pathname === '/'
    || request.nextUrl.pathname.startsWith('/club/')
    || request.nextUrl.pathname.startsWith('/brand/')
    || PUBLIC_PAGES.includes(request.nextUrl.pathname)
  ) {
    return NextResponse.next({ request });
  }

  const isLoginPage = request.nextUrl.pathname.startsWith('/login');
  // Password reset is requested while signed out; /update-password (the
  // second step) needs the session the recovery link creates, so it stays protected.
  const isAuthPage = isLoginPage || request.nextUrl.pathname.startsWith('/forgot-password');
  const isAuthCallback = request.nextUrl.pathname.startsWith('/auth/callback');
  const isProtectedPage = !isAuthPage && !isAuthCallback;
  const hasAuthCookie = hasSupabaseAuthCookie(request);

  // There is no session to validate; do not contact Auth just to redirect.
  if (isProtectedPage && !hasAuthCookie) {
    return redirectToLogin(request);
  }

  // The dashboard layout validates the user before rendering. Avoid making the
  // same remote getUser() request in middleware when an auth cookie is present.
  if (isProtectedPage && hasAuthCookie) {
    return NextResponse.next({ request });
  }

  // Anonymous visitors can render the login page without a Sydney Supabase
  // Auth round trip. A valid auth cookie still gets checked so signed-in users
  // are redirected to the dashboard.
  if (isAuthPage && !hasAuthCookie) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !isAuthPage && !isAuthCallback) {
    return redirectToLogin(request);
  }

  if (user && isLoginPage) {
    const next = safeRedirectPath(request.nextUrl.searchParams.get('next')) ?? DASHBOARD_PATH;
    return NextResponse.redirect(new URL(next, request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
