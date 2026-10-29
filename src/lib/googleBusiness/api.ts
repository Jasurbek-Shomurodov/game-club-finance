// Thin wrappers over the Google OAuth and Business Profile REST endpoints.
// `fetchImpl` is injectable so the routes' tests never reach Google.

import type { GoogleLocationInfo } from './listing';
import type { GoogleOAuthConfig } from './oauth';
import type { GoogleLocationOption, GooglePhotoCategory } from './posts';

type Fetch = typeof fetch;

export type GoogleApiErrorCode =
  /** The refresh token was revoked or expired: the owner must connect again. */
  | 'RECONNECT'
  /** Business Profile API access is not approved yet (quota 0) or is over quota. */
  | 'QUOTA'
  /** The Google account cannot manage this listing, or the API is disabled. */
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID'
  | 'FAILED';

export class GoogleApiError extends Error {
  constructor(readonly code: GoogleApiErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

function codeForStatus(status: number): GoogleApiErrorCode {
  if (status === 401) return 'RECONNECT';
  if (status === 429) return 'QUOTA';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 400) return 'INVALID';
  return 'FAILED';
}

async function googleJson<T>(fetchImpl: Fetch, url: string, init: RequestInit): Promise<T> {
  const response = await fetchImpl(url, init);
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = body.error as { message?: string; status?: string } | string | undefined;
    const message = typeof error === 'string' ? error : error?.message ?? `Google responded ${response.status}`;
    // Google reports an unapproved Business Profile project as a quota failure.
    const code = typeof error === 'object' && error?.status === 'RESOURCE_EXHAUSTED' ? 'QUOTA' : codeForStatus(response.status);
    throw new GoogleApiError(code, message, response.status);
  }
  return body as T;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export async function exchangeCode(config: GoogleOAuthConfig, code: string, redirectUri: string, fetchImpl: Fetch = fetch) {
  return googleJson<{ access_token: string; refresh_token?: string; id_token?: string }>(fetchImpl, TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
}

export async function refreshAccessToken(config: GoogleOAuthConfig, refreshToken: string, fetchImpl: Fetch = fetch) {
  try {
    const body = await googleJson<{ access_token: string }>(fetchImpl, TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
      }),
    });
    return body.access_token;
  } catch (error) {
    // invalid_grant: revoked, expired, or the password changed.
    if (error instanceof GoogleApiError && error.status === 400) throw new GoogleApiError('RECONNECT', error.message, 400);
    throw error;
  }
}

/** Best effort: the connection is removed here whether or not Google answers. */
export async function revokeToken(token: string, fetchImpl: Fetch = fetch) {
  await fetchImpl('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

const bearer = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

export async function fetchGoogleEmail(accessToken: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  try {
    const body = await googleJson<{ email?: string }>(fetchImpl, 'https://openidconnect.googleapis.com/v1/userinfo', { headers: bearer(accessToken) });
    return body.email ?? null;
  } catch {
    return null;
  }
}

function formatAddress(address: unknown): string {
  if (!address || typeof address !== 'object') return '';
  const { addressLines, locality } = address as { addressLines?: unknown; locality?: unknown };
  const lines = Array.isArray(addressLines) ? addressLines.filter((line): line is string => typeof line === 'string') : [];
  return [...lines, typeof locality === 'string' ? locality : ''].filter(Boolean).join(', ');
}

/** Every listing the signed-in Google account manages, across its accounts. */
export async function listLocations(accessToken: string, fetchImpl: Fetch = fetch): Promise<GoogleLocationOption[]> {
  const { accounts = [] } = await googleJson<{ accounts?: { name: string }[] }>(
    fetchImpl,
    'https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20',
    { headers: bearer(accessToken) },
  );
  const options: GoogleLocationOption[] = [];
  for (const account of accounts) {
    const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title,storefrontAddress&pageSize=100`;
    const { locations = [] } = await googleJson<{ locations?: { name: string; title?: string; storefrontAddress?: unknown }[] }>(
      fetchImpl, url, { headers: bearer(accessToken) },
    );
    for (const location of locations) {
      options.push({
        accountName: account.name,
        locationName: location.name,
        title: location.title ?? location.name,
        address: formatAddress(location.storefrontAddress),
      });
    }
  }
  return options;
}

const LOCATION_INFO_URL = 'https://mybusinessbusinessinformation.googleapis.com/v1';

/** The listing's editable info; `locationName` is `locations/<id>`. */
export async function getLocationInfo(accessToken: string, locationName: string, readMask: string, fetchImpl: Fetch = fetch) {
  return googleJson<GoogleLocationInfo>(
    fetchImpl,
    `${LOCATION_INFO_URL}/${locationName}?readMask=${encodeURIComponent(readMask)}`,
    { headers: bearer(accessToken) },
  );
}

export async function updateLocationInfo(
  accessToken: string,
  locationName: string,
  body: GoogleLocationInfo,
  updateMask: string,
  fetchImpl: Fetch = fetch,
) {
  return googleJson<GoogleLocationInfo>(fetchImpl, `${LOCATION_INFO_URL}/${locationName}?updateMask=${encodeURIComponent(updateMask)}`, {
    method: 'PATCH',
    headers: { ...bearer(accessToken), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** v4 resources live under `accounts/<id>/locations/<id>`. */
export function v4LocationPath(accountName: string, locationName: string) {
  return `https://mybusiness.googleapis.com/v4/${accountName}/${locationName}`;
}

export async function createLocalPost(accessToken: string, locationPath: string, post: object, fetchImpl: Fetch = fetch) {
  return googleJson<Record<string, unknown>>(fetchImpl, `${locationPath}/localPosts`, {
    method: 'POST',
    headers: { ...bearer(accessToken), 'content-type': 'application/json' },
    body: JSON.stringify(post),
  });
}

export async function listLocalPosts(accessToken: string, locationPath: string, fetchImpl: Fetch = fetch) {
  const body = await googleJson<{ localPosts?: unknown[] }>(fetchImpl, `${locationPath}/localPosts?pageSize=20`, { headers: bearer(accessToken) });
  return body.localPosts ?? [];
}

export async function createPhoto(
  accessToken: string,
  locationPath: string,
  sourceUrl: string,
  category: GooglePhotoCategory,
  fetchImpl: Fetch = fetch,
) {
  return googleJson<Record<string, unknown>>(fetchImpl, `${locationPath}/media`, {
    method: 'POST',
    headers: { ...bearer(accessToken), 'content-type': 'application/json' },
    body: JSON.stringify({ mediaFormat: 'PHOTO', locationAssociation: { category }, sourceUrl }),
  });
}
