import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { LOGIN_NEXT_COOKIE, safeRedirectPath } from '@/lib/validation';
import { DASHBOARD_PATH } from '@/lib/routes';

function decodeCookieValue(value: string | undefined): string | undefined {
  if (!value || value.startsWith('/')) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  // The login page stores the requested deep link before leaving for the provider.
  const next = safeRedirectPath(decodeCookieValue(request.cookies.get(LOGIN_NEXT_COOKIE)?.value));

  function redirectToLogin(withError: boolean) {
    const loginUrl = new URL('/login', origin);
    // Only a fixed marker is forwarded; provider error text is never shown to users.
    if (withError) loginUrl.searchParams.set('error', 'oauth');
    if (next) loginUrl.searchParams.set('next', next);
    const redirect = NextResponse.redirect(loginUrl);
    redirect.cookies.delete(LOGIN_NEXT_COOKIE);
    return redirect;
  }

  // Google / Supabase returned an OAuth error (e.g. user denied, bad redirect URL)
  if (error) {
    return redirectToLogin(true);
  }

  if (!code) {
    return redirectToLogin(false);
  }

  const response = NextResponse.redirect(new URL(next ?? DASHBOARD_PATH, origin));
  response.cookies.delete(LOGIN_NEXT_COOKIE);

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
            });
          },
        },
      }
    );
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      console.error('OAuth code exchange failed', exchangeError.message);
      return redirectToLogin(true);
    }
  } catch (exchangeError) {
    console.error('OAuth callback failed', exchangeError);
    return redirectToLogin(true);
  }

  return response;
}
