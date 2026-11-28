import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fullSchemaDatabase } from './__tests__/snapshotDatabase';

/**
 * Migration 193 on the full replayed schema: the bar line, another amount,
 * "Всё забрал / Всё в резерв" and the morning message's once-only record,
 * all acting as the linked owner through the existing RPCs.
 */

const owner = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const secondOwner = '00000000-0000-0000-0000-000000000003';
const otherOwner = '00000000-0000-0000-0000-000000000004';
const club = '10000000-0000-0000-0000-000000000001';
const otherClub = '10000000-0000-0000-0000-000000000002';
const closedClub = '10000000-0000-0000-0000-000000000003';
const cola = '20000000-0000-0000-0000-000000000001';
const ownerTelegram = 111_222_333;
const adminTelegram = 222_333_444;
const secondTelegram = 333_444_555;
const otherTelegram = 444_555_666;
const unlinkedTelegram = 999_888_777;
let db: PGlite;

interface Handover { id: string; side: string; payment_method: string | null; action: string; amount: number; group_id: string | null; mine: boolean }
interface Payload {
  club_id: string;
  business_date: string;
  balances: Record<string, { till: number; collected: number }>;
  handovers: Handover[];
  lines: Record<string, string>;
  day_id: string;
  status?: string;
  pending?: { id: string; kind: string; side: string; payment_method: string | null; action: string | null; amount: number | null; capped?: boolean; expired: boolean; items?: Array<{ payment_method: string; amount: number }> };
  prompt?: { id: string; side: string; payment_method: string | null; action: string; max_amount: number; day_chat_id: number | null; day_message_id: number | null };
  result?: { status: string; handover_id: string; side: string; payment_method: string | null; action: string; amount: number; group: boolean };
}

async function asService<T>(work: () => Promise<T>): Promise<T> {
  await db.exec(`set role service_role; select set_config('request.jwt.claim.sub','',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
}

async function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try { return await work(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
}

const call = (sql: string, params: unknown[]) => asService(() => db.query<{ payload: Payload }>(sql, params))
  .then((result) => result.rows[0].payload);
const today = (telegram: number, date: string, clubId = club) => call('select owner_bot_today($1, $2, $3) as payload', [telegram, clubId, date]);
const button = (telegram: number, id: string) => call('select owner_bot_button($1, $2) as payload', [telegram, id]);
const pick = (telegram: number, id: string, action: string) => call('select owner_bot_pick($1, $2, $3) as payload', [telegram, id, action]);
const confirm = (telegram: number, id: string) => call('select owner_bot_confirm_any($1, $2, $3, $4) as payload', [telegram, id, telegram, 77]);
const undo = (telegram: number, id: string) => call('select owner_bot_undo_any($1, $2) as payload', [telegram, id]);
const ask = (telegram: number, id: string, action: string) => call('select owner_bot_ask_amount($1, $2, $3, $4, $5) as payload', [telegram, id, action, telegram, 55]);
const promptSent = (telegram: number, promptId: string, messageId: number) => asService(() => db.query('select owner_bot_prompt_sent($1, $2, $3)', [telegram, promptId, messageId]));
const answer = (telegram: number, messageId: number, amount: number | null) => call('select owner_bot_answer_amount($1, $2, $3) as payload', [telegram, messageId, amount]);

const refused = (hint: string, code = expect.any(String)) => ({ hint, code });

/** Ledger rows as plain data, as the app's save RPCs would leave them (their checks are not under test). */
async function seed(sql: string) {
  await db.exec(`set session_replication_role = replica; ${sql}; set session_replication_role = origin;`);
}

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

const rows = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params).then((result) => result.rows);

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
    insert into public.owner_telegram_links (user_id, telegram_user_id) values
      ('${owner}', ${ownerTelegram}), ('${admin}', ${adminTelegram}),
      ('${secondOwner}', ${secondTelegram}), ('${otherOwner}', ${otherTelegram});
  `);
  await seed(`
    insert into public.products (id, club_id, name, sale_price, cost_price, current_stock) values ('${cola}','${club}','Cola',10000,6000,7);
    insert into public.daily_stock_counts (club_id, date, product_id, previous_stock, added_today, closing_stock, sold_quantity, sale_price, cost_price, bar_income, bar_cost, bar_profit) values
      ('${club}','2026-10-05','${cola}',60,0,15,45,10000,6000,450000,270000,180000),
      ('${club}','2026-10-12','${cola}',15,0,5,10,10000,6000,100000,60000,40000);
    -- The month's bar money: 550 000 of sales less 250 000 of purchases leaves 300 000 for the reserve.
    insert into public.stock_purchases (club_id, date, product_id, quantity, cost_price) values ('${club}','2026-10-03','${cola}',50,5000)
  `);
  await income('2026-10-05', { cash: 1_200_000, terminal: 800_000, card: 300_000 });
}, 120_000);

afterAll(async () => { await db?.close(); });

describe('acting as the linked owner (193)', () => {
  it('refuses an unlinked Telegram id, a non-owner, another club\'s owner and a closed club', async () => {
    await expect(today(unlinkedTelegram, '2026-10-05')).rejects.toMatchObject(refused('owner_bot_not_linked', '42501'));
    await expect(today(adminTelegram, '2026-10-05')).rejects.toMatchObject(refused('owner_bot_not_owner', '42501'));
    await expect(today(otherTelegram, '2026-10-05')).rejects.toMatchObject(refused('owner_bot_not_owner', '42501'));
    await expect(today(ownerTelegram, '2026-10-05', closedClub)).rejects.toMatchObject(refused('owner_bot_not_owner', '42501'));
    expect(await rows('select * from owner_bot_steps')).toEqual([]);
  });

  it('keeps every new function away from browser roles and its helpers away from the service role', async () => {
    for (const sql of [
      `select owner_bot_today(${ownerTelegram}, '${club}', '2026-10-05')`,
      `select owner_bot_button(${ownerTelegram}, gen_random_uuid())`,
      `select owner_bot_pick(${ownerTelegram}, gen_random_uuid(), 'reserve')`,
      `select owner_bot_ask_amount(${ownerTelegram}, gen_random_uuid(), 'reserve')`,
      `select owner_bot_answer_amount(${ownerTelegram}, 1, 1)`,
      `select owner_bot_confirm_any(${ownerTelegram}, gen_random_uuid())`,
      `select owner_bot_undo_any(${ownerTelegram}, gen_random_uuid())`,
      `select owner_bot_claim_day_message('${club}', '2026-10-05', ${ownerTelegram})`,
      `select * from owner_bot_club_owner_telegram_ids('${club}')`,
    ]) {
      await expect(asUser(owner, () => db.query(sql)), sql).rejects.toMatchObject({ code: '42501' });
    }
    for (const sql of [
      `select owner_bot_day_extras(${ownerTelegram}, '${owner}', '${club}', '2026-10-05')`,
      `select owner_bot_amount_limit('${club}', '2026-10-05', 'bar', null, 'reserve')`,
      `select owner_bot_bar_sales('${club}', '2026-10-05')`,
      `select owner_bot_reserve_bucket_lock('${club}', '2026-10-05')`,
      `select owner_bot_mark_lock('${club}', '2026-10-05', 'cash')`,
    ]) {
      await expect(asService(() => db.query(sql)), sql).rejects.toMatchObject({ code: '42501' });
    }
    await expect(asUser(owner, () => db.query('select * from owner_bot_steps'))).rejects.toMatchObject({ code: '42501' });
    await expect(asUser(owner, () => db.query('select * from owner_bot_day_messages'))).rejects.toMatchObject({ code: '42501' });
  });

  it('opens the day with one day row, kept on the next drawing, and the 192 line ids', async () => {
    const payload = await today(ownerTelegram, '2026-10-05');
    expect(payload).toMatchObject({ club_id: club, business_date: '2026-10-05', handovers: [] });
    expect(payload.day_id).toEqual(expect.any(String));
    expect(Object.keys(payload.lines).sort()).toEqual(['card', 'cash', 'playstation', 'terminal']);
    expect((await today(ownerTelegram, '2026-10-05')).day_id).toBe(payload.day_id);
    // Each Telegram account has its own rows.
    expect((await today(secondTelegram, '2026-10-05')).day_id).not.toBe(payload.day_id);
  });

  it('refuses another account\'s day row', async () => {
    const { day_id: dayId } = await today(ownerTelegram, '2026-10-05');
    await expect(button(secondTelegram, dayId)).rejects.toMatchObject(refused('owner_bot_forbidden', '42501'));
    await expect(pick(secondTelegram, dayId, 'left')).rejects.toMatchObject(refused('owner_bot_forbidden', '42501'));
    await expect(ask(secondTelegram, dayId, 'reserve')).rejects.toMatchObject(refused('owner_bot_forbidden', '42501'));
    await expect(button(ownerTelegram, '20000000-0000-4000-8000-000000000000')).rejects.toMatchObject(refused('owner_bot_expired'));
  });
});

describe('the bar line (193)', () => {
  it('caps the bar reserve by what the month\'s bar profit allows, and moves it as the owner', async () => {
    const { day_id: dayId } = await today(ownerTelegram, '2026-10-05');
    const chosen = await pick(ownerTelegram, dayId, 'reserve');
    // 450 000 sold that day, but only 300 000 of bar profit is left in October.
    expect(chosen.pending).toMatchObject({ kind: 'bar_choice', side: 'bar', action: 'reserve', amount: 300_000, capped: true });

    const saved = await confirm(ownerTelegram, chosen.pending!.id);
    expect(saved.result).toMatchObject({ status: 'saved', side: 'bar', action: 'reserve', amount: 300_000, group: false });
    const entry = await rows(
      "select source, payment_method, amount::int8 as amount, period_month::text, entry_date::text, created_by, comment from owner_reserve_entries where source = 'bar'",
    );
    expect(entry).toEqual([{ source: 'bar', payment_method: null, amount: 300000, period_month: '2026-10-01', entry_date: '2026-10-05', created_by: owner, comment: 'Telegram' }]);
    expect(saved.handovers).toEqual([expect.objectContaining({ side: 'bar', payment_method: null, action: 'reserve', amount: 300_000, mine: true })]);

    expect((await confirm(ownerTelegram, chosen.pending!.id)).result).toMatchObject({ status: 'already_saved' });
    expect(await rows("select 1 from owner_reserve_entries where source = 'bar'")).toHaveLength(1);

    // Marked once: the bar's buttons are refused until it is undone.
    await expect(pick(secondTelegram, (await today(secondTelegram, '2026-10-05')).day_id, 'left')).rejects.toMatchObject(refused('owner_bot_already_marked'));

    const undone = await undo(ownerTelegram, saved.result!.handover_id);
    expect(undone.result).toMatchObject({ status: 'undone', side: 'bar', action: 'reserve', amount: 300_000 });
    expect(await rows("select 1 from owner_reserve_entries where source = 'bar'")).toEqual([]);
    expect((await undo(ownerTelegram, saved.result!.handover_id)).result).toMatchObject({ status: 'already_undone' });
  });

  it('refuses the bar reserve once the month\'s bar profit is used up, with nothing saved', async () => {
    await asUser(owner, () => db.query(
      "select move_owner_profit_to_reserve($1, gen_random_uuid(), '2026-10-01', 'bar', null, 300000, 'all of it', '2026-10-12')",
      [club],
    ));
    const { day_id: dayId } = await today(ownerTelegram, '2026-10-05');
    await expect(pick(ownerTelegram, dayId, 'reserve')).rejects.toMatchObject(refused('owner_bot_bar_reserve_unavailable'));
    await expect(ask(ownerTelegram, dayId, 'reserve')).rejects.toMatchObject(refused('owner_bot_bar_reserve_unavailable'));
    expect(await rows("select 1 from owner_money_handovers where side = 'bar' and undone_at is null")).toEqual([]);
  });

  it('marks the bar money as left there with only a handover, undone by setting undone_at', async () => {
    const { day_id: dayId } = await today(ownerTelegram, '2026-10-05');
    const chosen = await pick(ownerTelegram, dayId, 'left');
    expect(chosen.pending).toMatchObject({ kind: 'bar_choice', action: 'left', amount: 450_000, capped: false });
    const reserveBefore = await rows('select count(*)::int as n from owner_reserve_entries');
    const saved = await confirm(ownerTelegram, chosen.pending!.id);
    expect(saved.result).toMatchObject({ status: 'saved', side: 'bar', action: 'left', amount: 450_000 });
    expect(await rows('select count(*)::int as n from owner_reserve_entries')).toEqual(reserveBefore);
    const undone = await undo(ownerTelegram, saved.result!.handover_id);
    expect(undone.result).toMatchObject({ status: 'undone', action: 'left' });
    expect(await rows('select undone_at is not null as undone from owner_money_handovers where id = $1', [saved.result!.handover_id]))
      .toEqual([{ undone: true }]);
  });

  it('refuses the bar on a day it sold nothing', async () => {
    await income('2026-10-20', { cash: 50_000 });
    const { day_id: dayId } = await today(ownerTelegram, '2026-10-20');
    await expect(pick(ownerTelegram, dayId, 'left')).rejects.toMatchObject(refused('owner_bot_nothing_in_bar'));
    await expect(pick(ownerTelegram, dayId, 'collected')).rejects.toMatchObject({ code: '22023' });
  });
});

describe('another amount (193)', () => {
  it('asks, matches the reply by its message and account, and collects exactly that sum', async () => {
    const { lines } = await today(ownerTelegram, '2026-10-05');
    const asked = await ask(ownerTelegram, lines.cash, 'collected');
    expect(asked.prompt).toMatchObject({ side: 'game_club', payment_method: 'cash', action: 'collected', max_amount: 1_200_000, day_chat_id: ownerTelegram, day_message_id: 55 });
    await promptSent(ownerTelegram, asked.prompt!.id, 901);

    // Another account replying to the same message id finds no question of its own.
    await expect(answer(secondTelegram, 901, 500_000)).rejects.toMatchObject(refused('owner_bot_expired'));
    expect((await answer(ownerTelegram, 901, null)).status).toBe('invalid');
    expect((await answer(ownerTelegram, 901, 0)).status).toBe('invalid');
    expect((await answer(ownerTelegram, 901, 1.5)).status).toBe('invalid');
    const tooLarge = await answer(ownerTelegram, 901, 1_200_001);
    expect(tooLarge).toMatchObject({ status: 'too_large', club_name: 'Square', prompt: { id: asked.prompt!.id, max_amount: 1_200_000 } });

    // A question asked again moves to its new message.
    await promptSent(ownerTelegram, asked.prompt!.id, 902);
    await expect(answer(ownerTelegram, 901, 500_000)).rejects.toMatchObject(refused('owner_bot_expired'));
    const chosen = await answer(ownerTelegram, 902, 500_000);
    expect(chosen.status).toBe('chosen');
    expect(chosen.pending).toMatchObject({ kind: 'choice', side: 'game_club', payment_method: 'cash', action: 'collected', amount: 500_000 });
    await expect(answer(ownerTelegram, 902, 500_000)).rejects.toMatchObject(refused('owner_bot_expired'));

    const saved = await confirm(ownerTelegram, chosen.pending!.id);
    expect(saved.result).toMatchObject({ status: 'saved', side: 'game_club', payment_method: 'cash', amount: 500_000, group: false });
    expect(saved.balances.cash).toEqual({ till: 700_000, collected: 500_000 });
    expect(saved.day_id).toEqual(expect.any(String));
    expect(await rows("select amount::int8 as amount, collected_by from money_collections where payment_method = 'cash'"))
      .toEqual([{ amount: 500000, collected_by: owner }]);
    await undo(ownerTelegram, saved.result!.handover_id);
    expect(await rows("select 1 from money_collections where payment_method = 'cash'")).toEqual([]);
  });

  it('asks for the bar\'s reserve only, up to the reservable part of its sales', async () => {
    await income('2026-11-02', { cash: 10_000 });
    await seed(`insert into public.daily_stock_counts (club_id, date, product_id, previous_stock, added_today, closing_stock, sold_quantity, sale_price, cost_price, bar_income, bar_cost, bar_profit)
      values ('${club}','2026-11-02','${cola}',20,0,10,10,10000,6000,100000,60000,40000)`);
    const { day_id: dayId } = await today(ownerTelegram, '2026-11-02');
    await expect(ask(ownerTelegram, dayId, 'collected')).rejects.toMatchObject({ code: '22023' });
    const asked = await ask(ownerTelegram, dayId, 'reserve');
    expect(asked.prompt).toMatchObject({ side: 'bar', payment_method: null, action: 'reserve', max_amount: 100_000 });
    await promptSent(ownerTelegram, asked.prompt!.id, 903);
    const chosen = await answer(ownerTelegram, 903, 40_000);
    expect(chosen.pending).toMatchObject({ kind: 'bar_choice', side: 'bar', action: 'reserve', amount: 40_000 });
    const saved = await confirm(ownerTelegram, chosen.pending!.id);
    expect(saved.result).toMatchObject({ status: 'saved', side: 'bar', amount: 40_000 });
    expect(await rows("select amount::int8 as amount from owner_reserve_entries where source = 'bar' and period_month = '2026-11-01'"))
      .toEqual([{ amount: 40000 }]);
  });
});

describe('everything at once (193)', () => {
  it('collects every method with money in one confirmation, one handover each, undone as a group', async () => {
    const { day_id: dayId } = await today(ownerTelegram, '2026-10-05');
    const chosen = await pick(ownerTelegram, dayId, 'all_collected');
    expect(chosen.pending).toMatchObject({ kind: 'all_choice', side: 'game_club', action: 'collected', amount: 2_300_000 });
    expect(chosen.pending!.items!.map((item) => [item.payment_method, item.amount])).toEqual([
      ['cash', 1_200_000], ['terminal', 800_000], ['card', 300_000],
    ]);

    const saved = await confirm(ownerTelegram, chosen.pending!.id);
    expect(saved.result).toMatchObject({ status: 'saved', side: 'game_club', action: 'collected', amount: 2_300_000, group: true });
    const marks = saved.handovers.filter((row) => row.side === 'game_club');
    // One transaction: the marks share their time, so they come back in id order.
    expect(marks.map((row) => row.payment_method).sort()).toEqual(['card', 'cash', 'terminal']);
    expect(new Set(marks.map((row) => row.group_id)).size).toBe(1);
    expect(marks[0].group_id).toEqual(expect.any(String));
    expect(await rows("select payment_method, amount::int8 as amount, collected_by, comment from money_collections where date = '2026-10-05' order by payment_method"))
      .toEqual([
        { payment_method: 'card', amount: 300000, collected_by: owner, comment: 'Telegram' },
        { payment_method: 'cash', amount: 1200000, collected_by: owner, comment: 'Telegram' },
        { payment_method: 'terminal', amount: 800000, collected_by: owner, comment: 'Telegram' },
      ]);
    expect((await confirm(ownerTelegram, chosen.pending!.id)).result).toMatchObject({ status: 'already_saved' });
    await expect(pick(ownerTelegram, dayId, 'all_reserve')).rejects.toMatchObject(refused('owner_bot_nothing_in_till'));
    await expect(undo(secondTelegram, marks[1].id)).rejects.toMatchObject(refused('owner_bot_forbidden', '42501'));

    const undone = await undo(ownerTelegram, marks[1].id);
    expect(undone.result).toMatchObject({ status: 'undone', group: true, amount: 2_300_000, payment_method: null });
    expect(undone.handovers.filter((row) => row.side === 'game_club')).toEqual([]);
    expect(await rows("select 1 from money_collections where date = '2026-10-05'")).toEqual([]);
    expect((await confirm(ownerTelegram, chosen.pending!.id)).result).toMatchObject({ status: 'already_undone' });
  });

  it('skips a method already marked, and saves nothing at all when one method\'s reserve is refused', async () => {
    const { lines, day_id: dayId } = await today(ownerTelegram, '2026-10-05');
    const card = await confirm(ownerTelegram, (await pick(ownerTelegram, lines.card, 'collected')).pending!.id);
    expect(card.result).toMatchObject({ status: 'saved', payment_method: 'card' });

    const chosen = await pick(ownerTelegram, dayId, 'all_reserve');
    expect(chosen.pending!.items!.map((item) => item.payment_method)).toEqual(['cash', 'terminal']);
    // The owner takes part of October's terminal profit before confirming: its reserve deposit no longer fits.
    await asUser(owner, () => db.query(
      "select withdraw_owner_game_club_money_by_method($1, '2026-10-01'::date, 'terminal', 300000, 'taken for the owner this week')",
      [club],
    ));
    await expect(confirm(ownerTelegram, chosen.pending!.id)).rejects.toMatchObject({ hint: 'reserve_exceeds_available' });
    expect(await rows("select payment_method from money_collections where date = '2026-10-05'")).toEqual([{ payment_method: 'card' }]);
    expect(await rows("select 1 from owner_money_handovers where group_id is not null and undone_at is null")).toEqual([]);
    expect(await rows("select 1 from owner_reserve_entries where source = 'game_club'")).toEqual([]);
  });

  it('refuses the group when one of its methods was marked after it was chosen', async () => {
    await income('2026-10-21', { cash: 100_000, terminal: 50_000 });
    const { lines, day_id: dayId } = await today(ownerTelegram, '2026-10-21');
    const group = await pick(ownerTelegram, dayId, 'all_collected');
    await confirm(secondTelegram, (await pick(secondTelegram, (await today(secondTelegram, '2026-10-21')).lines.cash, 'collected')).pending!.id);
    await expect(confirm(ownerTelegram, group.pending!.id)).rejects.toMatchObject(refused('owner_bot_already_marked'));
    expect(await rows("select payment_method from money_collections where date = '2026-10-21'")).toEqual([{ payment_method: 'cash' }]);
    expect(lines.terminal).toEqual(expect.any(String));
  });
});

describe('redrawing from any button (193)', () => {
  it('redraws from an expired choice instead of refusing it, and says it expired', async () => {
    await income('2026-10-22', { cash: 70_000 });
    const { lines } = await today(ownerTelegram, '2026-10-22');
    const chosen = await pick(ownerTelegram, lines.cash, 'collected');
    await db.query("update owner_bot_pending_actions set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where id = $1", [chosen.pending!.id]);
    const redrawn = await button(ownerTelegram, chosen.pending!.id);
    expect(redrawn.pending).toMatchObject({ id: chosen.pending!.id, kind: 'choice', payment_method: 'cash', expired: true });
    expect(redrawn.balances.cash.till).toBe(70_000);
    expect((await button(ownerTelegram, lines.cash)).pending).toMatchObject({ kind: 'line', expired: false });
    await expect(button(secondTelegram, chosen.pending!.id)).rejects.toMatchObject(refused('owner_bot_forbidden', '42501'));
  });
});

describe('the morning message record (193)', () => {
  it('lists the linked owners of an active club only', async () => {
    const ids = await asService(() => db.query<{ telegram_user_id: string }>('select telegram_user_id::text from owner_bot_club_owner_telegram_ids($1)', [club]));
    expect(ids.rows.map((row) => Number(row.telegram_user_id))).toEqual([ownerTelegram, secondTelegram]);
    const closed = await asService(() => db.query('select * from owner_bot_club_owner_telegram_ids($1)', [closedClub]));
    expect(closed.rows).toEqual([]);
  });

  it('lets one run send per club, date and owner; a definite failure gives the claim back, a sent message never', async () => {
    const claim = (telegram: number) => asService(() => db.query<{ claimed: boolean }>(
      'select owner_bot_claim_day_message($1, $2, $3) as claimed', [club, '2026-10-05', telegram],
    )).then((result) => result.rows[0].claimed);
    expect(await claim(ownerTelegram)).toBe(true);
    expect(await claim(ownerTelegram)).toBe(false);
    expect(await claim(secondTelegram)).toBe(true);

    await asService(() => db.query('select owner_bot_release_day_message($1, $2, $3)', [club, '2026-10-05', ownerTelegram]));
    expect(await claim(ownerTelegram)).toBe(true);
    await asService(() => db.query('select owner_bot_finish_day_message($1, $2, $3, $4, $5)', [club, '2026-10-05', ownerTelegram, ownerTelegram, 4001]));
    await asService(() => db.query('select owner_bot_release_day_message($1, $2, $3)', [club, '2026-10-05', ownerTelegram]));
    expect(await claim(ownerTelegram)).toBe(false);
    expect(await rows('select message_id::int as message_id from owner_bot_day_messages where telegram_user_id = $1', [ownerTelegram]))
      .toEqual([{ message_id: 4001 }]);
  });
});
