import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));

import { POST } from './route';

const OWNER_ID = '7d1f2c4e-1b6a-4f0e-9a51-0c3e2b7d8a10';
const USER_ID = '40c05af5-5a59-45ae-a891-19a18228a721';

function rejectRequest(userId: string = USER_ID) {
  return new Request('https://example.test/api/team/reject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
}

function queryResult<T>(data: T, error: { message: string } | null = null) {
  const builder = {
    select: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (value: { data: T; error: { message: string } | null }) => unknown) => (
      Promise.resolve({ data, error }).then(resolve)
    ),
  };
  builder.select.mockReturnValue(builder);
  builder.update.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return builder;
}

function mockClients({
  memberships = [] as Array<{ club_id: string }>,
  deleteError = null as { message: string } | null,
  rejected = [{ id: USER_ID }] as Array<{ id: string }>,
  rejectError = null as { message: string } | null,
} = {}) {
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: OWNER_ID } } }) },
    from: vi.fn(() => queryResult([{ club_id: 'club-1' }])),
  });

  const profileQuery = queryResult(rejected, rejectError);
  const deleteUser = vi.fn().mockResolvedValue({ error: deleteError });
  mocks.createServiceClient.mockReturnValue({
    auth: { admin: { deleteUser } },
    from: vi.fn((table: string) => (table === 'profiles' ? profileQuery : queryResult(memberships))),
  });
  return { deleteUser, profileQuery };
}

describe('team request rejection route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a sign-up that has no history', async () => {
    const { deleteUser, profileQuery } = mockClients();

    const response = await POST(rejectRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, outcome: 'deleted' });
    expect(deleteUser).toHaveBeenCalledWith(USER_ID);
    expect(profileQuery.update).not.toHaveBeenCalled();
  });

  it('hides the request when the account cannot be deleted because of its history', async () => {
    const { profileQuery } = mockClients({ deleteError: { message: 'Database error deleting user' } });

    const response = await POST(rejectRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, outcome: 'hidden' });
    expect(profileQuery.update).toHaveBeenCalledWith(expect.objectContaining({ access_rejected_by: OWNER_ID }));
    expect(profileQuery.eq).toHaveBeenCalledWith('id', USER_ID);
  });

  it('reports the failure when neither delete nor hide succeeds', async () => {
    mockClients({
      deleteError: { message: 'Database error deleting user' },
      rejectError: { message: 'column "access_rejected_at" does not exist' },
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(rejectRequest());

    expect(response.status).toBe(400);
  });

  it('refuses people who already have club access', async () => {
    const { deleteUser } = mockClients({ memberships: [{ club_id: 'inactive-club' }] });

    const response = await POST(rejectRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'has_access' });
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
