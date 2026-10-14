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

type DbError = { code?: string; message: string } | null;

function rejectRequest(userId: string = USER_ID) {
  return new Request('https://example.test/api/team/reject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
}

function queryResult<T>(data: T, error: DbError = null) {
  const builder = {
    select: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (value: { data: T; error: DbError }) => unknown) => (
      Promise.resolve({ data, error }).then(resolve)
    ),
  };
  builder.select.mockReturnValue(builder);
  builder.update.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return builder;
}

function mockClients({
  rpcData = 'rejected' as unknown,
  rpcError = null as DbError,
  ownedClubs = [{ club_id: 'club-1' }],
  memberships = [] as Array<{ club_id: string }>,
  profiles = [{ id: USER_ID, access_rejected_at: null }] as Array<{ id: string; access_rejected_at: string | null }>,
  profileError = null as DbError,
  marked = [{ id: USER_ID }],
  deleteError = null as { message: string } | null,
} = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: rpcError ? null : rpcData, error: rpcError });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: OWNER_ID } } }) },
    rpc,
    from: vi.fn(() => queryResult(ownedClubs)),
  });

  const profileRead = queryResult(profiles, profileError);
  const profileMark = queryResult(marked);
  const deleteUser = vi.fn().mockResolvedValue({ error: deleteError });
  mocks.createServiceClient.mockReturnValue({
    auth: { admin: { deleteUser } },
    from: vi.fn((table: string) => {
      if (table !== 'profiles') return queryResult(memberships);
      return {
        select: vi.fn(() => profileRead),
        update: vi.fn((values: unknown) => {
          profileMark.update(values);
          return profileMark;
        }),
      };
    }),
  });
  return { rpc, deleteUser, profileMark };
}

describe('team request rejection route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it('marks the request through the locking RPC, then deletes a sign-up with no history', async () => {
    const { rpc, deleteUser } = mockClients();

    const response = await POST(rejectRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, outcome: 'deleted' });
    expect(rpc).toHaveBeenCalledWith('reject_access_request', { p_user_id: USER_ID });
    expect(deleteUser).toHaveBeenCalledWith(USER_ID);
  });

  it('keeps the rejection mark when the account cannot be deleted because of its history', async () => {
    mockClients({ deleteError: { message: 'Database error deleting user' } });

    const response = await POST(rejectRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, outcome: 'hidden' });
  });

  it.each([
    ['has_access', 409],
    ['not_pending', 404],
  ])('never deletes when the RPC reports %s', async (outcome, status) => {
    const { deleteUser } = mockClients({ rpcData: outcome });

    const response = await POST(rejectRequest());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code: outcome });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('maps a non-owner to 403 and hides database details', async () => {
    const forbidden = mockClients({ rpcError: { code: '42501', message: 'Only a club owner can reject access requests.' } });
    const forbiddenResponse = await POST(rejectRequest());
    expect(forbiddenResponse.status).toBe(403);
    expect(forbidden.deleteUser).not.toHaveBeenCalled();

    mockClients({ rpcError: { code: '57014', message: 'canceling statement due to statement timeout' } });
    const failed = await POST(rejectRequest());
    expect(failed.status).toBe(500);
    const body = await failed.json();
    expect(body).toEqual({ error: 'reject_failed', code: 'reject_failed' });
    expect(JSON.stringify(body)).not.toContain('timeout');
  });

  it('refuses invalid ids and the caller themself', async () => {
    mockClients();
    expect((await POST(rejectRequest('not-a-uuid'))).status).toBe(400);
    expect((await POST(rejectRequest(OWNER_ID))).status).toBe(400);
  });

  describe('before migration 074', () => {
    const missingRpc = { code: 'PGRST202', message: 'Could not find the function public.reject_access_request' };

    it('marks then deletes an open request', async () => {
      const { deleteUser, profileMark } = mockClients({ rpcError: missingRpc });

      const response = await POST(rejectRequest());

      expect(response.status).toBe(200);
      expect(profileMark.update).toHaveBeenCalledWith(expect.objectContaining({ access_rejected_by: OWNER_ID }));
      expect(profileMark.is).toHaveBeenCalledWith('access_rejected_at', null);
      expect(deleteUser).toHaveBeenCalledWith(USER_ID);
    });

    it('refuses people who already have club access', async () => {
      const { deleteUser } = mockClients({ rpcError: missingRpc, memberships: [{ club_id: 'inactive-club' }] });

      const response = await POST(rejectRequest());

      expect(response.status).toBe(409);
      expect(deleteUser).not.toHaveBeenCalled();
    });

    it('refuses callers who own no club', async () => {
      const { deleteUser } = mockClients({ rpcError: missingRpc, ownedClubs: [] });

      expect((await POST(rejectRequest())).status).toBe(403);
      expect(deleteUser).not.toHaveBeenCalled();
    });

    it('deletes without a mark before 072 and reports a failed delete generically', async () => {
      const { deleteUser } = mockClients({
        rpcError: missingRpc,
        profileError: { code: '42703', message: 'column profiles.access_rejected_at does not exist' },
        deleteError: { message: 'Database error deleting user' },
      });

      const response = await POST(rejectRequest());

      expect(deleteUser).toHaveBeenCalledWith(USER_ID);
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: 'reject_failed', code: 'reject_failed' });
    });
  });
});
