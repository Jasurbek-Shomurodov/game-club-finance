import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutateFinanceRequest = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/client', () => ({ mutateFinanceRequest }));

import { recordCashShortage } from './cashShortageApi';

const input = {
  id: 'shortage', recoveryId: 'fine', date: '2026-11-11', source: 'game_club' as const, method: 'cash' as const,
  amount: 300_000, reason: 'stolen' as const, employeeId: null as string | null, comment: ' Cash missing at the handover ', recoverAmount: 100_000,
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => mutateFinanceRequest.mockReset());

describe('recordCashShortage', () => {
  it('posts through the route and sends no recovery without a responsible person', async () => {
    mutateFinanceRequest.mockResolvedValue(reply(201, { created: true }));
    expect(await recordCashShortage('club', input)).toBeNull();
    const [url, init] = mutateFinanceRequest.mock.calls[0];
    expect(url).toBe('/api/cash-shortages');
    expect(JSON.parse(init.body)).toMatchObject({ clubId: 'club', comment: 'Cash missing at the handover', recoverAmount: 0, recoveryId: null });
  });

  it('sends the recovery with its own id when someone is responsible', async () => {
    mutateFinanceRequest.mockResolvedValue(reply(201, { created: true }));
    await recordCashShortage('club', { ...input, employeeId: 'izzat' });
    expect(JSON.parse(mutateFinanceRequest.mock.calls[0][1].body)).toMatchObject({ employeeId: 'izzat', recoverAmount: 100_000, recoveryId: 'fine' });
  });

  it('passes known refusals through and treats anything else as a failure', async () => {
    mutateFinanceRequest.mockResolvedValueOnce(reply(409, { code: 'day_collected' }));
    expect(await recordCashShortage('club', input)).toBe('day_collected');
    mutateFinanceRequest.mockResolvedValueOnce(reply(401, {}));
    expect(await recordCashShortage('club', input)).toBe('forbidden');
    mutateFinanceRequest.mockResolvedValueOnce(reply(500, { code: 'something_else' }));
    expect(await recordCashShortage('club', input)).toBe('failed');
  });
});
