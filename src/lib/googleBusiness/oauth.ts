export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/business.manage'] as const;
export const OAUTH_STATE_COOKIE = 'gcf-google-oauth-state';
export const CALLBACK_PATH = '/api/google-business/callback';
export const RETURN_PATH = '/showcase/google';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  tokenSecret: string;
}

/** Null until all three server-only variables are set. */
export function readGoogleOAuthConfig(env: Record<string, string | undefined>): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const tokenSecret = env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  if (!clientId || !clientSecret || !tokenSecret || tokenSecret.length < 32) return null;
  return { clientId, clientSecret, tokenSecret };
}

export function callbackUrl(requestUrl: string) {
  return new URL(CALLBACK_PATH, requestUrl).toString();
}

/** Consent screen URL; `offline` + `consent` make Google return a refresh token every time. */
export function buildAuthUrl(config: GoogleOAuthConfig, redirectUri: string, state: string) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  }).toString();
  return url.toString();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{16,}$/;

/** The state is `<clubId>.<nonce>`; the nonce is also kept in an httpOnly cookie. */
export function buildState(clubId: string, nonce: string) {
  return `${clubId}.${nonce}`;
}

/** Returns the club only when the state is well formed and its nonce matches the cookie. */
export function verifyState(state: string | null, cookieNonce: string | undefined): string | null {
  if (!state || !cookieNonce) return null;
  const [clubId, nonce, extra] = state.split('.');
  if (extra !== undefined || !UUID.test(clubId ?? '') || !NONCE.test(nonce ?? '')) return null;
  return nonce === cookieNonce ? clubId : null;
}

export type ConnectOutcome = 'connected' | 'denied' | 'failed' | 'forbidden' | 'not_configured' | 'no_refresh_token';

export function returnUrl(requestUrl: string, outcome: ConnectOutcome) {
  const url = new URL(RETURN_PATH, requestUrl);
  url.searchParams.set('google', outcome);
  return url.toString();
}
