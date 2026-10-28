import type { GoogleLocationOption, GooglePostError, GooglePostSummary } from '@/lib/googleBusiness/posts';

export interface GoogleConnectionStatus {
  configured: boolean;
  connection: {
    googleEmail: string | null;
    locationName: string | null;
    locationTitle: string | null;
    connectedAt: string;
  } | null;
  locations?: GoogleLocationOption[];
  locationsError?: string | null;
}

export class GoogleRouteError extends Error {
  constructor(readonly code: string, readonly validation?: GooglePostError) {
    super(code);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const body = await response.json().catch(() => ({})) as { code?: string; validation?: GooglePostError };
  if (!response.ok) throw new GoogleRouteError(body.code ?? 'SERVER_ERROR', body.validation);
  return body as T;
}

const BASE = '/api/google-business';

export const googleBusinessApi = {
  status: (clubId: string) => call<GoogleConnectionStatus>(`${BASE}?clubId=${encodeURIComponent(clubId)}`),
  chooseLocation: (clubId: string, locationName: string) =>
    call<{ locationName: string; locationTitle: string }>(BASE, { method: 'PATCH', body: JSON.stringify({ clubId, locationName }) }),
  disconnect: (clubId: string) => call<{ connected: false }>(BASE, { method: 'DELETE', body: JSON.stringify({ clubId }) }),
  posts: (clubId: string) => call<{ posts: GooglePostSummary[] }>(`${BASE}/posts?clubId=${encodeURIComponent(clubId)}`),
  createPost: (clubId: string, post: object) =>
    call<{ post: GooglePostSummary | null }>(`${BASE}/posts`, { method: 'POST', body: JSON.stringify({ clubId, post }) }),
  addPhoto: (clubId: string, photoUrl: string, category: string) =>
    call<{ photo: unknown }>(`${BASE}/photos`, { method: 'POST', body: JSON.stringify({ clubId, photoUrl, category }) }),
  connectUrl: (clubId: string) => `${BASE}/connect?clubId=${encodeURIComponent(clubId)}`,
};

/** Message key in the `googleBusiness` namespace for a failed call. */
export function errorMessageKey(error: unknown): string {
  if (error instanceof GoogleRouteError) {
    if (error.validation) return `error_${error.validation}`;
    const known = ['GOOGLE_QUOTA', 'GOOGLE_RECONNECT', 'GOOGLE_FORBIDDEN', 'GOOGLE_INVALID', 'FORBIDDEN', 'NOT_CONFIGURED', 'NOT_CONNECTED', 'NO_LOCATION'];
    if (known.includes(error.code)) return `error_${error.code}`;
  }
  return 'error_generic';
}
