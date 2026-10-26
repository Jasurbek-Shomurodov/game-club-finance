import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countNoteWords } from '@/lib/entryNote';

const migration = readFileSync(resolve(process.cwd(), 'migrations', '108_required_entry_notes.sql'), 'utf8');
const NOTE = 'Bought water and bread for the bar';
let db: PGlite;

const insert = (table: string, comment: string | null, extra = '') =>
  db.query(`insert into public.${table} (comment${extra ? ', salary_entry_id' : ''}) values ($1${extra ? `, ${extra}` : ''})`, [comment]);
const words = async (note: string) => (await db.query<{ n: number }>('select public.entry_note_word_count($1) as n', [note])).rows[0].n;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create table public.expenses (id serial primary key, comment text, salary_entry_id uuid);
    create table public.money_exchanges (id serial primary key, comment text not null default '');
    create table public.new_debts (id serial primary key, comment text);
    create table public.debt_payments (id serial primary key, comment text);
    create table public.owner_withdrawals (id serial primary key, comment text);
    insert into public.expenses (comment) values ('non'), (null);
    insert into public.debt_payments (comment) values ('naushnik');
  `);
  await db.exec(migration);
  await db.exec(migration);
}, 60_000);

afterAll(async () => { await db?.close(); });

describe('required entry notes (108)', () => {
  it('refuses a new entry without a 5-word note on every covered ledger', async () => {
    for (const table of ['expenses', 'money_exchanges', 'new_debts', 'debt_payments', 'owner_withdrawals']) {
      for (const comment of [null, '', 'suv', 'two words  - ...  ...']) {
        await expect(insert(table, comment)).rejects.toMatchObject({ code: '23514', hint: 'note_required' });
      }
      await insert(table, NOTE);
    }
  });

  it('exempts payroll expenses and leaves existing rows editable', async () => {
    await insert('expenses', null, `'00000000-0000-0000-0000-000000000009'`);
    await db.exec(`update public.expenses set comment = 'x' where comment = 'non'`);
    await db.exec(`delete from public.debt_payments where comment = 'naushnik'`);
  });

  it('never counts fewer words than the app', async () => {
    for (const note of [
      'Купили наушники для второго зала',
      "Bar uchun o‘yinchoq va g'isht oldik",
      'non,suv,choy - ... ok',
      '  Paid\n internet\tfor October 2026  ',
    ]) {
      expect(await words(note)).toBeGreaterThanOrEqual(countNoteWords(note));
    }
    expect(await words('Купили наушники для второго зала')).toBe(5);
  });
});
