import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES } from '@/lib/expenseCategories';

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.expenses(id serial primary key, category text not null, comment text);
    insert into public.expenses(category, comment) values
      ('rent', null), ('OVQAT', null), ('Musur', 'bags'), ('ashibka', ''), ('SKIDKA', null),
      ('INTERNET TARIF', null), ('RASXOD', 'misc'), ('  Shakar ', null), ('brand new thing', null);
  `);
  await db.exec(readFileSync(resolve('migrations/068_unify_expense_categories.sql'), 'utf8'));
  await db.exec(readFileSync(resolve('migrations/069_remove_other_expense_category.sql'), 'utf8'));
  await db.exec(readFileSync(resolve('migrations/088_investments_expense_category.sql'), 'utf8'));
});
afterAll(async () => { await db?.close(); });

describe('migration 068 unifies expense categories', () => {
  it('maps legacy text into the fixed list and keeps the original in the comment', async () => {
    const rows = (await db.query<{ category: string; comment: string | null }>('select category, comment from expenses order by id')).rows;
    expect(rows).toEqual([
      { category: 'rent', comment: null },
      { category: 'food_drinks', comment: 'OVQAT' },
      { category: 'cleaning', comment: 'Musur: bags' },
      { category: 'correction', comment: 'ashibka' },
      { category: 'discount', comment: 'SKIDKA' },
      { category: 'internet', comment: 'INTERNET TARIF' },
      { category: 'supplies', comment: 'RASXOD: misc' },
      { category: 'food_drinks', comment: '  Shakar ' },
      { category: 'supplies', comment: 'brand new thing' },
    ]);
  });
  it('rejects other and unknown categories afterwards and matches the application list', async () => {
    await expect(db.query("insert into expenses(category) values ('custom')")).rejects.toThrow();
    await expect(db.query("insert into expenses(category) values ('other')")).rejects.toThrow();
    await db.query("insert into expenses(category) values ('salary')");
    for (const category of EXPENSE_CATEGORIES) await db.query('insert into expenses(category) values ($1)', [category]);
  });
});
