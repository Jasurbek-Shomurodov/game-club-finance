import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const sql = readFileSync(resolve('migrations', '083_expense_update_column_grant.sql'), 'utf8');
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated;
    create table public.expenses(
      id int primary key, amount numeric not null, date date not null,
      telegram_chat_id text, telegram_message_id bigint
    );
    grant select, insert, update, delete on public.expenses to authenticated;
    insert into public.expenses values (1, 50000, '2026-10-01', null, null);
  `);
  await db.exec(sql);
  await db.exec(sql); // re-runnable
});

afterAll(async () => { await db.close(); });

async function asAuthenticated(statement: string) {
  await db.exec('set role authenticated');
  try {
    return await db.exec(statement);
  } finally {
    await db.exec('reset role');
  }
}

describe('083 expense update column grant', () => {
  it('lets app users save Telegram message coordinates', async () => {
    await asAuthenticated(`update public.expenses set telegram_chat_id = '-1001', telegram_message_id = 42 where id = 1`);
    const { rows } = await db.query<{ telegram_message_id: number }>('select telegram_message_id from public.expenses where id = 1');
    expect(Number(rows[0].telegram_message_id)).toBe(42);
  });

  it('refuses rewriting the amount or date of a recorded expense', async () => {
    await expect(asAuthenticated('update public.expenses set amount = 1 where id = 1')).rejects.toThrow(/permission denied/);
    await expect(asAuthenticated(`update public.expenses set date = '2026-01-01' where id = 1`)).rejects.toThrow(/permission denied/);
  });

  it('keeps insert and delete privileges for the route and its RLS policies', async () => {
    await asAuthenticated(`insert into public.expenses values (2, 1000, '2026-10-02', null, null)`);
    await asAuthenticated('delete from public.expenses where id = 2');
  });
});
