// Test-only. Building a PGlite database and replaying the migration chain costs seconds per test file, and most
// files build exactly the same one. snapshotDatabase() runs the setup SQL once per test run, saves the resulting data
// directory, and gives every caller in every worker a fresh database loaded from that copy (about 0.1 s). Snapshots
// live in a directory that vitest.globalSetup.ts creates for the run and deletes afterwards, so nothing built in an
// earlier run, against older migrations or at an earlier time, is ever reused. The key is the setup SQL itself plus
// the extension names.
import { PGlite, type Extensions } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Without the global setup each worker keeps its own snapshots, in a directory of its own.
const cacheDir = process.env.PGLITE_SNAPSHOT_DIR ?? mkdtempSync(join(tmpdir(), 'pglite-snapshots-'));
// A lock older than this belongs to a worker that died mid-build.
const staleLockMs = 180_000;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Runs `build` once across all workers: the first takes a directory lock, the rest wait for the file. */
async function buildOnce(file: string, build: () => Promise<Uint8Array>) {
  const lock = `${file}.lock`;
  for (;;) {
    if (existsSync(file)) return;
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > staleLockMs) rmSync(lock, { recursive: true, force: true });
      } catch {
        // The lock went away between the two calls.
      }
      await sleep(100);
    }
  }
  try {
    if (existsSync(file)) return;
    const data = await build();
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, data);
    renameSync(temporary, file);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** A new PGlite database in the state the `steps` (SQL run in order) leave it, loaded from this run's snapshot. */
export async function snapshotDatabase(steps: readonly string[], extensions: Extensions = {}): Promise<PGlite> {
  const key = createHash('sha256')
    .update(`${Object.keys(extensions).sort().join(',')}\0`)
    .update(steps.join('\0'))
    .digest('hex')
    .slice(0, 32);
  const file = join(cacheDir, `${key}.tar`);
  if (!existsSync(file)) {
    await buildOnce(file, async () => {
      // Start from the empty cluster's own snapshot, which skips initdb (most of a new PGlite's start-up).
      const db = steps.length ? await snapshotDatabase([], extensions) : new PGlite({ extensions });
      try {
        for (const step of steps) await db.exec(step);
        return new Uint8Array(await (await db.dumpDataDir('none')).arrayBuffer());
      } finally {
        await db.close();
      }
    });
  }
  const db = new PGlite({ loadDataDir: new Blob([readFileSync(file)]), extensions });
  await db.waitReady;
  return db;
}

/** A new, empty database: the same as `new PGlite({ extensions })`, without paying for initdb in every test file. */
export const emptyDatabase = (extensions: Extensions = {}) => snapshotDatabase([], extensions);

const migrationsDir = resolve(process.cwd(), 'migrations');

/** A migration's SQL, without the pg_cron and pg_net extensions PGlite does not have (their stand-ins are below). */
export const readMigration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8')
  .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');

/** Every migration file name, in the order production applies them. */
export const migrationNames = () => readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();

/** The Supabase pieces the migrations expect: roles, auth.uid()/auth.role(), and pg_cron/pg_net stand-ins. */
export const supabaseStandIns = `
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth; create schema extensions; create schema cron; create schema net;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
    create table cron.job(jobid bigserial primary key, jobname text, schedule text, command text);
    create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (job_name, schedule, command) returning jobid $$;
    create function cron.unschedule(job_id bigint) returns boolean language sql as $$ delete from cron.job where jobid = job_id returning true $$;
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
    grant usage on schema public, auth, extensions, cron, net to authenticated, anon, service_role;
  `;

/** The whole production schema: the Supabase stand-ins, then every migration (or those `include` keeps), in order. */
export const fullSchemaDatabase = (include: (name: string) => boolean = () => true) => snapshotDatabase(
  [supabaseStandIns, ...migrationNames().filter(include).map(readMigration)],
  { uuid_ossp },
);
