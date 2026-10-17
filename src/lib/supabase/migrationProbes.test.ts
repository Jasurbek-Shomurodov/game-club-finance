import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { buildMigrationManifest, splitStatements } from './migrationProbes';
import manifest from './migrationManifest.json';

const build = (...sqls: string[]) =>
  buildMigrationManifest(sqls.map((sql, i) => ({ file: `00${i + 1}_m.sql`, sql }))).map((entry) => entry.probes);
const md5 = (text: string) => createHash('md5').update(text).digest('hex');

describe('migration probes', () => {
  it('is regenerated for every committed migration (npm run migrations:manifest)', () => {
    const files = readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort();
    expect(manifest).toEqual(buildMigrationManifest(files.map((file) => ({ file, sql: readFileSync(`migrations/${file}`, 'utf8') }))));
  });

  it('splits statements outside comments, strings and dollar-quoted bodies', () => {
    expect(splitStatements("select ';'; -- a; b\ncreate function f() returns int as $$ select 1; $$ language sql; /* x; */ select \"a;b\""))
      .toEqual(["select ';'", 'create function f() returns int as $$ select 1; $$ language sql', 'select "a;b"']);
  });

  it('attributes an object only to its sole creator when nothing later drops it', () => {
    expect(build(
      'create table public.a (id uuid primary key, name text, constraint a_name check (name <> \'\')); create index a_idx on a (name);',
      'alter table a add column if not exists note text, add constraint a_note check (note is not null); create policy "Read a" on public.a for select using (true);',
      'drop policy if exists "Read a" on public.a; create policy "Read a" on public.a using (true); alter table a drop column name;',
    )).toEqual([
      [{ kind: 'relation', name: 'public.a' }, { kind: 'column', table: 'public.a', column: 'id' },
        { kind: 'constraint', table: 'public.a', name: 'a_name' }, { kind: 'relation', name: 'public.a_idx' }],
      [{ kind: 'column', table: 'public.a', column: 'note' }, { kind: 'constraint', table: 'public.a', name: 'a_note' }],
      [],
    ]);
  });

  it('drops probes for objects of a dropped table and for conditional removals in DO blocks', () => {
    expect(build(
      "create table t (id int); create trigger trg before insert on t for each row execute function f(); create type r as enum ('a', 'b');",
      "drop table if exists t; do $$ begin if true then alter type r rename value 'a' to 'c'; end if; end $$;",
    )).toEqual([[{ kind: 'type', name: 'public.r' }, { kind: 'enumValue', type: 'public.r', value: 'b' }], []]);
  });

  it('probes a function by signature once and by body hash when a later migration redefines it', () => {
    const fn = (body: string) => `create or replace function public.f(p_id uuid, p_at timestamptz default now(), out total numeric(12,2)) returns numeric language sql as $$${body}$$;`;
    expect(build(fn(' select 1 '), '', fn(' select 2 '), fn(' select 2 '))).toEqual([[], [], [], []]);
    expect(build(fn(' select 1 '), fn(' select 2 '))).toEqual([
      [], [{ kind: 'functionBody', signature: 'public.f(uuid,timestamp with time zone)', md5: md5(' select 2 ') }],
    ]);
    expect(build(fn(' select 1 '))).toEqual([[{ kind: 'function', signature: 'public.f(uuid,timestamp with time zone)' }]]);
    expect(build(fn(' select 1 '), 'drop function if exists public.f(uuid, timestamp with time zone);')).toEqual([[], []]);
  });
});
