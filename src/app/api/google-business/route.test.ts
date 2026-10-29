import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptToken } from '@/lib/googleBusiness/tokenCrypto';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));

import { DELETE, GET, PATCH } from './route';
import { GET as connect } from './connect/route';
import { GET as callback } from './callback/route';
import { GET as listPosts, POST as createPost } from './posts/route';
import { POST as addPhoto } from './photos/route';
import { GET as getListing, PATCH as saveListing } from './listing/route';

const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const SECRET = 'a-long-random-secret-of-more-than-32-characters';
const ORIGIN = 'https://admin.pixelgaming.uz';

interface Row {
  club_id: string;
  google_email: string | null;
  refresh_token_encrypted: string;
  account_name: string | null;
  location_name: string | null;
  location_title: string | null;
  connected_at: string;
}

let row: Row | null;
let writes: { op: string; value?: unknown }[];

function connectedRow(patch: Partial<Row> = {}): Row {
  return {
    club_id: CLUB,
    google_email: 'owner@example.test',
    refresh_token_encrypted: encryptToken('refresh-1', SECRET),
    account_name: 'accounts/1',
    location_name: 'locations/2',
    location_title: 'Pixel Gaming',
    connected_at: '2026-10-29T08:00:00Z',
    ...patch,
  };
}

function mockUser({ role = 'owner' as string | null, showcase = true, signedIn = true } = {}) {
  const rpc = vi.fn((name: string) => Promise.resolve({
    data: name === 'current_user_club_role' ? role : showcase,
    error: null,
  }));
  mocks.createClient.mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: signedIn ? { id: 'user-1' } : null } }) },
    rpc,
  });
  return rpc;
}

function mockService() {
  mocks.createServiceClient.mockReturnValue({
    from: () => {
      const builder: Record<string, unknown> = {};
      let op = 'select';
      let value: unknown;
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = () => Promise.resolve({ data: row, error: null });
      builder.upsert = (next: unknown) => { writes.push({ op: 'upsert', value: next }); return Promise.resolve({ error: null }); };
      builder.update = (next: unknown) => { op = 'update'; value = next; return builder; };
      builder.delete = () => { op = 'delete'; return builder; };
      builder.then = (resolve: (result: { error: null }) => unknown) => {
        writes.push({ op, value });
        return Promise.resolve({ error: null }).then(resolve);
      };
      return builder;
    },
  });
}

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;
let google: Handler;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const result = google(String(input), init) ?? { status: 404, body: { error: { message: 'unexpected' } } };
  return new Response(JSON.stringify(result.body), { status: result.status ?? 200 });
});

/** Google with one account, one listing and working tokens. */
const happyGoogle: Handler = (url) => {
  if (url === 'https://oauth2.googleapis.com/token') return { body: { access_token: 'access-1', refresh_token: 'refresh-new' } };
  if (url.startsWith('https://openidconnect.googleapis.com')) return { body: { email: 'owner@example.test' } };
  if (url.startsWith('https://mybusinessaccountmanagement.googleapis.com')) return { body: { accounts: [{ name: 'accounts/1' }] } };
  if (url.startsWith('https://mybusinessbusinessinformation.googleapis.com/v1/accounts/1/locations')) {
    return { body: { locations: [{ name: 'locations/2', title: 'Pixel Gaming', storefrontAddress: { addressLines: ['Amir Temur 1'], locality: 'Tashkent' } }] } };
  }
  if (url === 'https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts') {
    return { body: { name: 'accounts/1/locations/2/localPosts/9', topicType: 'STANDARD', summary: 'Hi', state: 'LIVE' } };
  }
  if (url.startsWith('https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts?')) return { body: { localPosts: [{ name: 'p1', summary: 'Old' }] } };
  if (url === 'https://mybusiness.googleapis.com/v4/accounts/1/locations/2/media') return { body: { name: 'm1', googleUrl: 'https://lh3/x' } };
  if (url === 'https://oauth2.googleapis.com/revoke') return { body: {} };
  return undefined;
};

const json = (method: string, path: string, body: unknown) => new Request(`${ORIGIN}${path}`, {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'client-id');
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'client-secret');
  vi.stubEnv('GOOGLE_TOKEN_ENCRYPTION_KEY', SECRET);
  row = connectedRow();
  writes = [];
  google = happyGoogle;
  mockUser();
  mockService();
});

describe('GET /api/google-business', () => {
  it('returns the connection without its token', async () => {
    const response = await GET(new Request(`${ORIGIN}/api/google-business?clubId=${CLUB}`));
    const body = await response.json();
    expect(body).toEqual({
      configured: true,
      connection: { googleEmail: 'owner@example.test', locationName: 'locations/2', locationTitle: 'Pixel Gaming', connectedAt: '2026-10-29T08:00:00Z' },
    });
    expect(JSON.stringify(body)).not.toContain('v1.');
  });

  it('refuses members without the public page feature', async () => {
    const rpc = mockUser({ role: 'admin', showcase: false });
    expect((await GET(new Request(`${ORIGIN}/api/google-business?clubId=${CLUB}`))).status).toBe(403);
    expect(rpc).toHaveBeenCalledWith('current_user_can_access_club_feature', { p_club_id: CLUB, p_feature_key: 'showcase' });
    mockUser({ signedIn: false });
    expect((await GET(new Request(`${ORIGIN}/api/google-business?clubId=${CLUB}`))).status).toBe(401);
  });

  it('reports a missing server setup', async () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', '');
    expect(await (await GET(new Request(`${ORIGIN}/api/google-business?clubId=${CLUB}`))).json()).toEqual({ configured: false, connection: null });
  });

  it('lists listings to choose from, or why Google refused', async () => {
    row = connectedRow({ account_name: null, location_name: null, location_title: null });
    const body = await (await GET(new Request(`${ORIGIN}/api/google-business?clubId=${CLUB}`))).json();
    expect(body.locations).toEqual([{ accountName: 'accounts/1', locationName: 'locations/2', title: 'Pixel Gaming', address: 'Amir Temur 1, Tashkent' }]);

    google = (url, init) => (url.startsWith('https://mybusinessaccountmanagement')
      ? { status: 429, body: { error: { message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } } }
      : happyGoogle(url, init));
    expect(await (await GET(new Request(`${ORIGIN}/api/google-business?clubId=${CLUB}`))).json()).toMatchObject({ locations: [], locationsError: 'QUOTA' });
  });
});

describe('PATCH and DELETE /api/google-business', () => {
  it('lets an owner choose only a listing of the connected account', async () => {
    row = connectedRow({ account_name: null, location_name: null });
    expect((await PATCH(json('PATCH', '/api/google-business', { clubId: CLUB, locationName: 'locations/999' }))).status).toBe(400);
    expect((await PATCH(json('PATCH', '/api/google-business', { clubId: CLUB, locationName: 'locations/2' }))).status).toBe(200);
    expect(writes).toContainEqual({ op: 'update', value: expect.objectContaining({ account_name: 'accounts/1', location_name: 'locations/2' }) });
  });

  it('keeps connection changes to owners', async () => {
    mockUser({ role: 'admin', showcase: true });
    expect((await PATCH(json('PATCH', '/api/google-business', { clubId: CLUB, locationName: 'locations/2' }))).status).toBe(403);
    expect((await DELETE(json('DELETE', '/api/google-business', { clubId: CLUB }))).status).toBe(403);
    expect(writes).toEqual([]);
  });

  it('revokes the stored token and deletes the row', async () => {
    expect((await DELETE(json('DELETE', '/api/google-business', { clubId: CLUB }))).status).toBe(200);
    const revoke = fetchMock.mock.calls.find(([url]) => String(url) === 'https://oauth2.googleapis.com/revoke');
    expect(String(revoke?.[1]?.body)).toBe('token=refresh-1');
    expect(writes).toEqual([{ op: 'delete', value: undefined }]);
  });
});

describe('Google sign-in', () => {
  it('sends an owner to Google with a state cookie', async () => {
    const response = await connect(new Request(`${ORIGIN}/api/google-business/connect?clubId=${CLUB}`));
    const location = new URL(response.headers.get('location')!);
    expect(location.host).toBe('accounts.google.com');
    const nonce = location.searchParams.get('state')!.split('.')[1];
    expect(response.headers.get('set-cookie')).toContain(`gcf-google-oauth-state=${nonce}`);
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/i);
  });

  it('returns non-owners to the page', async () => {
    mockUser({ role: 'viewer' });
    const response = await connect(new Request(`${ORIGIN}/api/google-business/connect?clubId=${CLUB}`));
    expect(response.headers.get('location')).toBe(`${ORIGIN}/showcase/google?google=forbidden`);
  });

  async function returnFromGoogle(query: string, cookieNonce = 'abcdefghijklmnopqrstuvwx') {
    const { NextRequest } = await import('next/server');
    const request = new NextRequest(`${ORIGIN}/api/google-business/callback?${query}`, { headers: { cookie: `gcf-google-oauth-state=${cookieNonce}` } });
    return (await callback(request)).headers.get('location');
  }
  const state = `${CLUB}.abcdefghijklmnopqrstuvwx`;

  it('saves the encrypted token and selects the only listing', async () => {
    row = null;
    expect(await returnFromGoogle(`code=c1&state=${state}`)).toBe(`${ORIGIN}/showcase/google?google=connected`);
    const saved = writes[0]?.value as Row;
    expect(saved).toMatchObject({ club_id: CLUB, google_email: 'owner@example.test', account_name: 'accounts/1', location_name: 'locations/2' });
    expect(saved.refresh_token_encrypted).not.toContain('refresh-new');
  });

  it('rejects a state that this browser did not start', async () => {
    expect(await returnFromGoogle(`code=c1&state=${state}`, 'zzzzzzzzzzzzzzzzzzzzzzzz')).toBe(`${ORIGIN}/showcase/google?google=failed`);
    expect(await returnFromGoogle(`error=access_denied&state=${state}`)).toBe(`${ORIGIN}/showcase/google?google=denied`);
    expect(writes).toEqual([]);
  });
});

describe('posts and photos', () => {
  it('publishes a valid post to the chosen listing', async () => {
    const response = await createPost(json('POST', '/api/google-business/posts', {
      clubId: CLUB,
      post: { kind: 'update', language: 'uz', summary: 'Hi', ctaType: 'CALL' },
    }));
    expect(response.status).toBe(200);
    const sent = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/localPosts'));
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({ languageCode: 'uz', topicType: 'STANDARD', summary: 'Hi', callToAction: { actionType: 'CALL' } });
    expect(sent?.[1]?.headers).toMatchObject({ authorization: 'Bearer access-1' });
  });

  it('validates before calling Google', async () => {
    const response = await createPost(json('POST', '/api/google-business/posts', { clubId: CLUB, post: { kind: 'update', language: 'uz', summary: '' } }));
    expect(await response.json()).toEqual({ code: 'INVALID_REQUEST', validation: 'summary_required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for a reconnect when Google revoked the token', async () => {
    google = (url, init) => (url === 'https://oauth2.googleapis.com/token' ? { status: 400, body: { error: 'invalid_grant' } } : happyGoogle(url, init));
    const response = await listPosts(new Request(`${ORIGIN}/api/google-business/posts?clubId=${CLUB}`));
    expect(await response.json()).toEqual({ code: 'GOOGLE_RECONNECT' });
  });

  it('needs a chosen listing', async () => {
    row = connectedRow({ account_name: null, location_name: null });
    expect(await (await listPosts(new Request(`${ORIGIN}/api/google-business/posts?clubId=${CLUB}`))).json()).toEqual({ code: 'NO_LOCATION' });
  });

  it('adds a public https photo to the gallery', async () => {
    expect((await addPhoto(json('POST', '/api/google-business/photos', { clubId: CLUB, photoUrl: 'http://x.test/a.jpg', category: 'INTERIOR' }))).status).toBe(400);
    const response = await addPhoto(json('POST', '/api/google-business/photos', { clubId: CLUB, photoUrl: 'https://x.test/a.jpg', category: 'INTERIOR' }));
    expect(await response.json()).toEqual({ photo: { name: 'm1', googleUrl: 'https://lh3/x' } });
    const sent = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/media'));
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({ mediaFormat: 'PHOTO', locationAssociation: { category: 'INTERIOR' }, sourceUrl: 'https://x.test/a.jpg' });
  });
});

describe('listing info', () => {
  const LISTING_URL = 'https://mybusinessbusinessinformation.googleapis.com/v1/locations/2';
  const live = {
    title: 'Pixel Gaming',
    profile: { description: 'Old text' },
    phoneNumbers: { primaryPhone: '+998901112233', additionalPhones: ['+998712223344'] },
    websiteUri: 'https://pixelgaming.uz',
    regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 10 }, closeDay: 'TUESDAY', closeTime: { hours: 2 } }] },
  };
  const listingGoogle: Handler = (url, init) => (url.startsWith(LISTING_URL) ? { body: live } : happyGoogle(url, init));
  const days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  const editedForm = {
    description: 'New text',
    phone: '+998 90 999 88 77',
    website: 'https://pixelgaming.uz',
    hours: Object.fromEntries(days.map((day) => [day, { closed: false, allDay: true, open: '00:00', close: '00:00' }])),
  };

  it('reads the listing for people with the public page feature', async () => {
    google = listingGoogle;
    mockUser({ role: 'admin', showcase: true });
    const body = await (await getListing(new Request(`${ORIGIN}/api/google-business/listing?clubId=${CLUB}`))).json();
    expect(body.listing).toMatchObject({ title: 'Pixel Gaming', description: 'Old text', phone: '+998 90 111 22 33' });
    expect(body.listing.hours.MONDAY).toEqual({ closed: false, allDay: false, open: '10:00', close: '02:00' });
  });

  it('saves only the changed fields and keeps the other phone numbers', async () => {
    google = listingGoogle;
    const response = await saveListing(json('PATCH', '/api/google-business/listing', { clubId: CLUB, form: editedForm, fields: ['description', 'phone'] }));
    expect(response.status).toBe(200);
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(String(patch?.[0])).toBe(`${LISTING_URL}?updateMask=${encodeURIComponent('profile.description,phoneNumbers')}`);
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      profile: { description: 'New text' },
      phoneNumbers: { primaryPhone: '+998 90 999 88 77', additionalPhones: ['+998712223344'] },
    });
  });

  it('keeps listing edits to owners and validates before calling Google', async () => {
    mockUser({ role: 'admin', showcase: true });
    expect((await saveListing(json('PATCH', '/api/google-business/listing', { clubId: CLUB, form: editedForm, fields: ['website'] }))).status).toBe(403);
    mockUser();
    const invalid = await saveListing(json('PATCH', '/api/google-business/listing', { clubId: CLUB, form: { ...editedForm, website: 'nope' }, fields: ['website'] }));
    expect(await invalid.json()).toEqual({ code: 'INVALID_REQUEST', validation: 'website_invalid' });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });
});
