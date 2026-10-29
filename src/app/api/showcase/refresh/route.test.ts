import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/publicShowcase', () => ({ PUBLIC_SHOWCASE_TAG: 'public-showcase' }));
vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }));

import { POST } from './route';

function signIn(user: object | null) {
  mocks.createClient.mockResolvedValue({ auth: { getUser: () => Promise.resolve({ data: { user } }) } });
}

describe('POST /api/showcase/refresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clears the cached public reads for a signed-in user', async () => {
    signIn({ id: 'u1' });
    const response = await POST();
    expect(response.status).toBe(204);
    expect(mocks.revalidateTag).toHaveBeenCalledWith('public-showcase', { expire: 0 });
  });

  it('refuses anonymous callers', async () => {
    signIn(null);
    expect((await POST()).status).toBe(401);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});
