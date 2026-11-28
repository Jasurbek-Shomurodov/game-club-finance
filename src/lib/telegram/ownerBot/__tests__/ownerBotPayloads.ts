/** Test-only: what the migration 192 wrappers answer for one club's day. */

export const CLUB = '10000000-0000-0000-0000-000000000001';
export const LINE = '30000000-0000-4000-8000-000000000001';
export const CHOICE = '30000000-0000-4000-8000-000000000002';
export const HANDOVER = '30000000-0000-4000-8000-000000000003';

export const dayPayload = (extra: Record<string, unknown> = {}) => ({
  club_id: CLUB,
  club_name: 'Square',
  business_date: '2026-11-27',
  balances: {
    cash: { till: 1_200_000, collected: 0 },
    terminal: { till: '700000.4', collected: 0 },
    card: { till: -5, collected: 0 },
    playstation: { till: 0, collected: 0 },
  },
  handovers: [
    { id: HANDOVER, side: 'game_club', payment_method: 'card', action: 'collected', amount: 300_000, created_at: '2026-11-28T04:55:00+00:00', undo_until: '2026-11-28T05:05:00+00:00', mine: true },
    // Bar marks (slice 4) are left out of the Game Club lines.
    { id: 'bar', side: 'bar', payment_method: null, action: 'reserve', amount: 1, created_at: '', undo_until: '', mine: true },
  ],
  lines: { cash: LINE, terminal: LINE, card: LINE, playstation: LINE },
  ...extra,
});
