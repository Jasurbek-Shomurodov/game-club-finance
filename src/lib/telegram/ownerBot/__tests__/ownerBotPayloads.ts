/** Test-only: what the migration 192/193 wrappers answer for one club's day. */

export const CLUB = '10000000-0000-0000-0000-000000000001';
export const LINE = '30000000-0000-4000-8000-000000000001';
export const CHOICE = '30000000-0000-4000-8000-000000000002';
export const HANDOVER = '30000000-0000-4000-8000-000000000003';
export const DAY = '30000000-0000-4000-8000-000000000004';
export const PROMPT = '30000000-0000-4000-8000-000000000005';

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
    { id: HANDOVER, side: 'game_club', payment_method: 'card', action: 'collected', amount: 300_000, group_id: null, created_at: '2026-11-28T04:55:00+00:00', undo_until: '2026-11-28T05:05:00+00:00', mine: true },
    // A mark the bot cannot read is left out.
    { id: 'odd', side: 'game_club', payment_method: null, action: 'reserve', amount: 1, created_at: '', undo_until: '', mine: true },
  ],
  lines: { cash: LINE, terminal: LINE, card: LINE, playstation: LINE },
  day_id: DAY,
  ...extra,
});

/** owner_bot_button / owner_bot_pick's description of a row. */
export const pendingPayload = (extra: Record<string, unknown> = {}) => ({
  id: LINE,
  kind: 'line',
  side: 'game_club',
  payment_method: 'cash',
  action: null,
  amount: null,
  expired: false,
  ...extra,
});
