import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidateTag: vi.fn(),
  fetchPublicBrand: vi.fn(),
  after: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/publicShowcase', () => ({ PUBLIC_SHOWCASE_TAG: 'public-showcase', fetchPublicBrand: mocks.fetchPublicBrand }));
vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock('next/server', () => ({ after: mocks.after }));

import { POST } from './route';

function signIn(user: object | null) {
  mocks.createClient.mockResolvedValue({ auth: { getUser: () => Promise.resolve({ data: { user } }) } });
}

describe('POST /api/showcase/refresh', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('clears the cached public reads for a signed-in user', async () => {
    signIn({ id: 'u1' });
    const response = await POST();
    expect(response.status).toBe(204);
    expect(mocks.revalidateTag).toHaveBeenCalledWith('public-showcase', { expire: 0 });
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it('refuses anonymous callers', async () => {
    signIn(null);
    expect((await POST()).status).toBe(401);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('asks search engines to recrawl every public page after the response', async () => {
    vi.stubEnv('PUBLIC_SITE_HOSTS', 'pixelgaming.uz,www.pixelgaming.uz');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    mocks.fetchPublicBrand.mockResolvedValue({ clubs: [{ slug: 'pixel-game-club' }] });
    signIn({ id: 'u1' });
    await POST();
    await mocks.after.mock.calls[0][0]();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.indexnow.org/indexnow');
    const body = JSON.parse(init.body);
    expect(body.host).toBe('www.pixelgaming.uz');
    expect(body.urlList).toContain('https://www.pixelgaming.uz/club/pixel-game-club?lang=uz');
  });

  it('skips the ping when no public site is configured', async () => {
    vi.stubEnv('PUBLIC_SITE_HOSTS', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    signIn({ id: 'u1' });
    await POST();
    await mocks.after.mock.calls[0][0]();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
