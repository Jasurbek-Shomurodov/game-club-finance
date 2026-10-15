import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec('create role authenticated; create role anon; create role service_role;');
  await db.exec(readFileSync(resolve('migrations', '080_assistant_model_usage.sql'), 'utf8'));
});

afterAll(async () => {
  await db.close();
});

async function record(model: string, exhausted = false) {
  await db.query('select public.record_assistant_model_request($1::date, $2, $3)', ['2026-10-15', model, exhausted]);
}

describe('080 assistant model usage', () => {
  it('counts requests per model and day and keeps the exhausted flag', async () => {
    await record('gemini-3.8-flash');
    await record('gemini-3.8-flash');
    await record('gemini-3.8-flash', true);
    await record('gemini-3.8-flash');
    await record('gemini-3.7-flash');

    const { rows } = await db.query('select model, requests, exhausted from assistant_model_usage order by model');
    expect(rows).toEqual([
      { model: 'gemini-3.7-flash', requests: 1, exhausted: false },
      { model: 'gemini-3.8-flash', requests: 3, exhausted: true },
    ]);
  });

  it('is reachable only by the service role', async () => {
    const { rows } = await db.query<{ role: string; usable: boolean }>(`
      select role, has_function_privilege(role, 'public.record_assistant_model_request(date,text,boolean)', 'execute') as usable
      from unnest(array['anon','authenticated','service_role']) as role order by role`);
    expect(rows).toEqual([
      { role: 'anon', usable: false },
      { role: 'authenticated', usable: false },
      { role: 'service_role', usable: true },
    ]);

    const table = await db.query<{ role: string; readable: boolean }>(`
      select role, has_table_privilege(role, 'public.assistant_model_usage', 'select') as readable
      from unnest(array['anon','authenticated','service_role']) as role order by role`);
    expect(table.rows.map((row) => row.readable)).toEqual([false, false, true]);
  });
});
