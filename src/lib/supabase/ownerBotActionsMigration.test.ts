import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fullSchemaDatabase } from './__tests__/snapshotDatabase';

/**
 * Migration 192 on the full replayed schema: the owner bot collects and moves
 * money into the reserve as the linked owner, through the existing RPCs.
 */

const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const secondOwner = '00000000-0000-0000-0000-000000000003';
const otherOwner = '00000000-0000-0000-0000-000000000004';
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
const closedClub = '10000000-0000-0000-0000-000000000003';
const ownerTelegram = 111_222_333;
const adminTelegram = 222_333_444;
const secondTelegram = 333_444_555;
const otherTelegram = 444_555_666;
const unlinkedTelegram = 999_888_777;
const day = '2024-08-05';
let db: PGlite;

interface DayPayload {
  club_id: string;
  club_name: string;
  business_date: string;
  balances: Record<string, { till: number; collected: number }>;
  handovers: Array<{ id: string; payment_method: string; action: string; amount: number; mine: boolean; undo_until: string }>;
  lines: Record<string, string>;
  pending?: { id: string; payment_method: string; action: string | null; amount: number | null };
  result?: { status: string; handover_id: string; payment_method: string; action: string; amount: number };
}

/** As the bot's webhook: the service role, with no user in the JWT. */
async function asService<T>(work: () => Promise<T>): Promise<T> {
  await db.exec(`set role service_role; select set_config('request.jwt.claim.sub','',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
}

const call = (sql: string, params: unknown[]) => asService(() => db.query<{ payload: DayPayload }>(sql, params))
  .then((result) => result.rows[0].payload);
const openDay = (telegram: number, clubId = club, date = day) => call('select owner_bot_open_day($1, $2, $3) as payload', [telegram, clubId, date]);
const choose = (telegram: number, lineId: string, action: string) => call('select owner_bot_choose($1, $2, $3) as payload', [telegram, lineId, action]);
const confirm = (telegram: number, choiceId: string) => call('select owner_bot_confirm($1, $2, $3, $4) as payload', [telegram, choiceId, telegram, 77]);
const undo = (telegram: number, handoverId: string) => call('select owner_bot_undo($1, $2) as payload', [telegram, handoverId]);
const pending = (telegram: number, id: string) => call('select owner_bot_pending($1, $2) as payload', [telegram, id]);

const refused = (hint: string, code = expect.any(String)) => ({ hint, code });

/** Income written as the owner (the table's triggers read auth.uid()), outside the bot. */
async function income(date: string, amounts: Partial<Record<'cash' | 'terminal' | 'card' | 'playstation', number>>) {
  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`);
  try {
    await db.query(
      `insert into daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [club, date, amounts.cash ?? 0, amounts.terminal ?? 0, amounts.card ?? 0, amounts.playstation ?? 0, owner],
    );
  } finally {
    await db.exec(`select set_config('request.jwt.claim.sub','',false)`);
  }
}

beforeAll(async () => {
  db = await fullSchemaDatabase();
  await db.exec(`
    alter role service_role bypassrls;
    insert into auth.users values ('${owner}','o@x.test'), ('${admin}','a@x.test'), ('${secondOwner}','s@x.test'), ('${otherOwner}','x@x.test');
    insert into public.clubs (id, name) values ('${club}', 'Square'), ('${otherClub}', 'Algoritm'), ('${closedClub}', 'Closed');
    insert into public.club_memberships (club_id, user_id, role) values
      ('${club}','${owner}','owner'), ('${club}','${admin}','admin'), ('${club}','${secondOwner}','owner'),
      ('${closedClub}','${owner}','owner'), ('${otherClub}','${otherOwner}','owner');
    update public.clubs set is_active = false where id = '${closedClub}';
    -- Links are made by /link (190); here they are written directly.
    insert into public.owner_telegram_links (user_id, telegram_user_id) values
      ('${owner}', ${ownerTelegram}), ('${admin}', ${adminTelegram}),
      ('${secondOwner}', ${secondTelegram}), ('${otherOwner}', ${otherTelegram});
  `);
  await income(day, { cash: 1_200_000, terminal: 800_000, card: 300_000 });
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('acting as the linked owner (192)', () => {
  it('refuses an unlinked Telegram id, a non-owner, another club\'s owner and a closed club', async () => {
    await expect(openDay(unlinkedTelegram)).rejects.toMatchObject(refused('owner_bot_not_linked', '42501'));
    await expect(openDay(adminTelegram)).rejects.toMatchObject(refused('owner_bot_not_owner', '42501'));
    await expect(openDay(otherTelegram)).rejects.toMatchObject(refused('owner_bot_not_owner', '42501'));
    await expect(openDay(ownerTelegram, closedClub)).rejects.toMatchObject(refused('owner_bot_not_owner', '42501'));
    expect((await db.query('select * from owner_bot_pending_actions')).rows).toEqual([]);
  });

  it('keeps every wrapper away from browser roles and the act-as helper away from the service role too', async () => {
    await expect(asUser(owner, () => db.query('select owner_bot_open_day($1, $2, $3)', [ownerTelegram, club, day])))
      .rejects.toMatchObject({ code: '42501' });
    for (const sql of [
      'select owner_bot_choose($1, gen_random_uuid(), \'collected\')',
      'select owner_bot_confirm($1, gen_random_uuid())',
      'select owner_bot_undo($1, gen_random_uuid())',
      'select owner_bot_pending($1, gen_random_uuid())',
    ]) {
      await expect(asUser(owner, () => db.query(sql, [ownerTelegram]))).rejects.toMatchObject({ code: '42501' });
    }
    await expect(asService(() => db.query('select owner_bot_act_as($1, $2)', [ownerTelegram, club]))).rejects.toMatchObject({ code: '42501' });
    await expect(asUser(owner, () => db.query('select * from owner_bot_pending_actions'))).rejects.toMatchObject({ code: '42501' });
  });

  it('opens the day with the till per method, no marks and one line id per method', async () => {
    const payload = await openDay(ownerTelegram);
    expect(payload).toMatchObject({ club_id: club, club_name: 'Square', business_date: day, handovers: [] });
    expect(payload.balances).toMatchObject({ cash: { till: 1_200_000 }, terminal: { till: 800_000 }, card: { till: 300_000 }, playstation: { till: 0 } });
    expect(Object.keys(payload.lines).sort()).toEqual(['card', 'cash', 'playstation', 'terminal']);
    // The same lines again: one row per method and day.
    expect((await openDay(ownerTelegram)).lines).toEqual(payload.lines);
  });

  it('refuses a day after the club\'s business date', async () => {
    await expect(openDay(ownerTelegram, club, '2999-01-01')).rejects.toMatchObject({ code: '22007' });
  });
});

describe('collecting from the bot (192)', () => {
  let handoverId: string;

  it('refuses another Telegram account pressing the owner\'s button', async () => {
    const { lines } = await openDay(ownerTelegram);
    await expect(choose(secondTelegram, lines.cash, 'collected')).rejects.toMatchObject(refused('owner_bot_forbidden', '42501'));
    await expect(choose(unlinkedTelegram, lines.cash, 'collected')).rejects.toMatchObject(refused('owner_bot_forbidden', '42501'));
  });

  it('fixes what is in the till when the owner chooses, and saves it once as the owner', async () => {
    const { lines } = await openDay(ownerTelegram);
    const chosen = await choose(ownerTelegram, lines.cash, 'collected');
    expect(chosen.pending).toMatchObject({ payment_method: 'cash', action: 'collected', amount: 1_200_000 });

    const saved = await confirm(ownerTelegram, chosen.pending!.id);
    expect(saved.result).toMatchObject({ status: 'saved', payment_method: 'cash', action: 'collected', amount: 1_200_000 });
    handoverId = saved.result!.handover_id;
    expect(saved.handovers).toEqual([expect.objectContaining({ id: handoverId, payment_method: 'cash', action: 'collected', mine: true })]);
    expect(saved.balances.cash).toEqual({ till: 0, collected: 1_200_000 });

    // A second press, or Telegram sending the same update again, saves nothing twice.
    const again = await confirm(ownerTelegram, chosen.pending!.id);
    expect(again.result).toMatchObject({ status: 'already_saved', handover_id: handoverId });
    const collections = await db.query<{ amount: string; collected_by: string; comment: string }>(
      'select amount::text, collected_by, comment from money_collections where club_id = $1', [club],
    );
    // auth.uid() was the owner inside collect_money.
    expect(collections.rows).toEqual([{ amount: '1200000', collected_by: owner, comment: 'Telegram' }]);
    const handovers = await db.query<{ created_by: string; telegram_chat_id: string; telegram_message_id: string }>(
      'select created_by, telegram_chat_id::text, telegram_message_id::text from owner_money_handovers',
    );
    expect(handovers.rows).toEqual([{ created_by: owner, telegram_chat_id: String(ownerTelegram), telegram_message_id: '77' }]);
    const audit = await db.query<{ changed_by: string; action: string }>(
      "select changed_by, action from entry_audit_logs where table_name = 'owner_money_handovers' order by id",
    );
    expect(audit.rows).toEqual([{ changed_by: owner, action: 'insert' }]);
  });

  it('refuses marking the same money again, and a method with nothing in the till', async () => {
    const { lines } = await openDay(secondTelegram);
    await expect(choose(secondTelegram, lines.cash, 'reserve')).rejects.toMatchObject(refused('owner_bot_already_marked'));
    await expect(choose(secondTelegram, lines.playstation, 'collected')).rejects.toMatchObject(refused('owner_bot_nothing_in_till'));
  });

  it('refuses a confirmation of the same method chosen before the first was saved', async () => {
    const { lines } = await openDay(secondTelegram);
    const first = await choose(secondTelegram, lines.card, 'collected');
    const second = await choose(secondTelegram, lines.card, 'reserve');
    await confirm(secondTelegram, first.pending!.id);
    await expect(confirm(secondTelegram, second.pending!.id)).rejects.toMatchObject(refused('owner_bot_already_marked'));
    const cardCollections = await db.query("select 1 from money_collections where payment_method = 'card'");
    expect(cardCollections.rows).toHaveLength(1);
  });

  it('refuses an expired confirmation and another owner\'s undo', async () => {
    const { lines } = await openDay(ownerTelegram);
    const chosen = await choose(ownerTelegram, lines.terminal, 'collected');
    await db.query("update owner_bot_pending_actions set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where id = $1", [chosen.pending!.id]);
    await expect(confirm(ownerTelegram, chosen.pending!.id)).rejects.toMatchObject(refused('owner_bot_expired'));
    await expect(undo(secondTelegram, handoverId)).rejects.toMatchObject(refused('owner_bot_forbidden', '42501'));
    await expect(undo(unlinkedTelegram, handoverId)).rejects.toMatchObject(refused('owner_bot_not_linked', '42501'));
  });

  it('undoes the collection as the owner within 10 minutes, once', async () => {
    const undone = await undo(ownerTelegram, handoverId);
    expect(undone.result).toMatchObject({ status: 'undone', payment_method: 'cash', amount: 1_200_000 });
    expect(undone.balances.cash).toEqual({ till: 1_200_000, collected: 0 });
    expect(undone.handovers.map((row) => row.payment_method)).toEqual(['card']);
    expect((await undo(ownerTelegram, handoverId)).result).toMatchObject({ status: 'already_undone' });
    expect((await db.query("select 1 from money_collections where payment_method = 'cash'")).rows).toEqual([]);
    const audit = await db.query<{ table_name: string; action: string; changed_by: string }>(
      "select table_name, action, changed_by from entry_audit_logs where table_name in ('money_collections', 'owner_money_handovers') and action <> 'insert' order by id",
    );
    expect(audit.rows).toEqual([
      { table_name: 'money_collections', action: 'delete', changed_by: owner },
      { table_name: 'owner_money_handovers', action: 'update', changed_by: owner },
    ]);
  });

  it('refuses an undo after 10 minutes', async () => {
    const { lines } = await openDay(ownerTelegram);
    const saved = await confirm(ownerTelegram, (await choose(ownerTelegram, lines.cash, 'collected')).pending!.id);
    await db.query("update owner_money_handovers set created_at = now() - interval '11 minutes' where id = $1", [saved.result!.handover_id]);
    await expect(undo(ownerTelegram, saved.result!.handover_id)).rejects.toMatchObject(refused('owner_bot_undo_expired'));
  });
});

describe('moving into the reserve from the bot (192)', () => {
  it('collects and deposits in one go as the owner, and undoes both', async () => {
    const { lines } = await openDay(ownerTelegram);
    const chosen = await choose(ownerTelegram, lines.terminal, 'reserve');
    expect(chosen.pending).toMatchObject({ action: 'reserve', amount: 800_000 });
    const saved = await confirm(ownerTelegram, chosen.pending!.id);
    expect(saved.result).toMatchObject({ status: 'saved', action: 'reserve', amount: 800_000 });
    expect(saved.balances.terminal).toEqual({ till: 0, collected: 0 });
    const entry = await db.query<{ id: string; amount: string; created_by: string; from_collected: boolean }>(
      "select id, amount::int8::text as amount, created_by, from_collected from owner_reserve_entries where payment_method = 'terminal'",
    );
    expect(entry.rows).toEqual([{ id: expect.any(String), amount: '800000', created_by: owner, from_collected: true }]);
    const audit = await db.query<{ changed_by: string }>(
      "select changed_by from entry_audit_logs where table_name = 'owner_reserve_entries' and action = 'insert'",
    );
    expect(audit.rows).toEqual([{ changed_by: owner }]);

    const undone = await undo(ownerTelegram, saved.result!.handover_id);
    expect(undone.result).toMatchObject({ status: 'undone', action: 'reserve' });
    expect(undone.balances.terminal).toEqual({ till: 800_000, collected: 0 });
    expect((await db.query("select 1 from owner_reserve_entries where payment_method = 'terminal'")).rows).toEqual([]);
    expect((await db.query("select 1 from money_collections where payment_method = 'terminal'")).rows).toEqual([]);
  });

  it('refuses an undo when the collected money was already spent', async () => {
    const { lines } = await openDay(ownerTelegram);
    const saved = await confirm(ownerTelegram, (await choose(ownerTelegram, lines.terminal, 'collected')).pending!.id);
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false)`);
    await db.query(
      `insert into expenses (club_id, date, amount, category, payment_method, payment_source, comment, created_by, paid_from_collected)
       values ($1, $2, 500000, 'supplies', 'terminal', 'game_club', 'paid for the supplies this week', $3, true)`,
      [club, day, owner],
    );
    await db.exec(`select set_config('request.jwt.claim.sub','',false)`);
    await expect(undo(ownerTelegram, saved.result!.handover_id)).rejects.toMatchObject({ hint: 'COLLECTED_INSUFFICIENT' });
  });

  it('keeps the reserve cap of move_collected_to_reserve, saving nothing', async () => {
    await income('2024-08-06', { playstation: 400_000 });
    // Money the owner already took out of the month's PlayStation profit stays in the till.
    await asUser(owner, () => db.query(
      "select withdraw_owner_game_club_money_by_method($1, '2024-08-01'::date, 'playstation', 300000, 'taken for the owner this week')",
      [club],
    ));
    const { lines, balances } = await openDay(ownerTelegram, club, '2024-08-06');
    expect(balances.playstation.till).toBe(400_000);
    const chosen = await choose(ownerTelegram, lines.playstation, 'reserve');
    await expect(confirm(ownerTelegram, chosen.pending!.id)).rejects.toMatchObject({ hint: 'reserve_exceeds_available' });
    expect((await db.query("select 1 from money_collections where payment_method = 'playstation'")).rows).toEqual([]);
    expect((await db.query("select 1 from owner_money_handovers where payment_method = 'playstation'")).rows).toEqual([]);
  });
});

describe('the pending button (192)', () => {
  it('answers the day of a button for its own account only', async () => {
    const { lines } = await openDay(ownerTelegram);
    const payload = await pending(ownerTelegram, lines.cash);
    expect(payload.pending).toEqual({ id: lines.cash, payment_method: 'cash', action: null, amount: null });
    await expect(pending(secondTelegram, lines.cash)).rejects.toMatchObject(refused('owner_bot_forbidden', '42501'));
    await expect(pending(ownerTelegram, '20000000-0000-0000-0000-000000000000')).rejects.toMatchObject(refused('owner_bot_expired'));
  });

  it('refuses an expired line, gives the next drawing of its day a new one, and renews valid lines only near expiry', async () => {
    const { lines } = await openDay(ownerTelegram);
    const expiry = (id: string) => db.query<{ expires_at: string }>('select expires_at::text from owner_bot_pending_actions where id = $1', [id])
      .then((result) => result.rows[0]?.expires_at ?? null);
    const fresh = await expiry(lines.cash);
    // Plenty of time left: drawing the day again does not touch the row.
    await openDay(ownerTelegram);
    expect(await expiry(lines.cash)).toBe(fresh);

    // Two days left: renewed for 7 days.
    await db.query("update owner_bot_pending_actions set created_at = now() - interval '6 days', expires_at = now() + interval '2 days' where id = $1", [lines.terminal]);
    await openDay(ownerTelegram);
    const renewed = await db.query<{ days: number }>(
      'select round(extract(epoch from (expires_at - now())) / 86400)::int as days from owner_bot_pending_actions where id = $1', [lines.terminal],
    );
    expect(renewed.rows[0].days).toBe(7);

    // Expired: refused, never renewed, and replaced when the day is drawn again.
    await db.query("update owner_bot_pending_actions set created_at = now() - interval '8 days', expires_at = now() - interval '1 hour' where id = $1", [lines.card]);
    await expect(pending(ownerTelegram, lines.card)).rejects.toMatchObject(refused('owner_bot_expired'));
    await expect(choose(ownerTelegram, lines.card, 'collected')).rejects.toMatchObject(refused('owner_bot_expired'));
    const redrawn = await openDay(ownerTelegram);
    expect(redrawn.lines.card).not.toBe(lines.card);
    expect(await expiry(lines.card)).toBeNull();
    expect(redrawn.lines.cash).toBe(lines.cash);
  });

  it('answers a resent ✅ Да after the undo as already undone, saving nothing', async () => {
    await income('2024-08-08', { card: 90_000 });
    const { lines } = await openDay(ownerTelegram, club, '2024-08-08');
    const chosen = await choose(ownerTelegram, lines.card, 'collected');
    const saved = await confirm(ownerTelegram, chosen.pending!.id);
    await undo(ownerTelegram, saved.result!.handover_id);
    const again = await confirm(ownerTelegram, chosen.pending!.id);
    expect(again.result).toMatchObject({ status: 'already_undone', handover_id: saved.result!.handover_id });
    expect((await db.query("select 1 from money_collections where date = '2024-08-08'")).rows).toEqual([]);
  });
});

describe('auth.uid() from request.jwt.claims (192)', () => {
  it('makes the owner the caller when auth.uid() reads only the claims JSON, as PostgREST sets it', async () => {
    await income('2024-08-07', { cash: 250_000 });
    await db.exec(`
      create or replace function auth.uid() returns uuid language sql stable as $$
        select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
      $$;
    `);
    try {
      await db.exec(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
      const { lines } = await openDay(secondTelegram, club, '2024-08-07');
      const chosen = await choose(secondTelegram, lines.cash, 'collected');
      const saved = await confirm(secondTelegram, chosen.pending!.id);
      const row = await db.query<{ collected_by: string }>(
        'select collected_by from money_collections where request_id = (select request_id from owner_money_handovers where id = $1)',
        [saved.result!.handover_id],
      );
      expect(row.rows).toEqual([{ collected_by: secondOwner }]);
    } finally {
      await db.exec(`
        select set_config('request.jwt.claims', '', false);
        create or replace function auth.uid() returns uuid language sql stable as $$
          select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
      `);
    }
  });
});
