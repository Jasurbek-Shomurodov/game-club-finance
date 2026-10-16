import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const path = (relative: string) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const read = (relative: string) => readFileSync(path(relative), 'utf8');
const run = (script: string, args: string[] = [], env: Record<string, string> = {}) =>
  spawnSync('bash', [path(script), ...args], { env: { NODE_ENV: 'test', PATH: process.env.PATH, ...env } });
const configured = Object.fromEntries(
  ['SUPABASE_DB_URL', 'AGE_PUBLIC_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
    .map((name) => [name, 'x']),
);

describe('database backup', () => {
  it('ships valid bash scripts', () => {
    for (const script of ['scripts/db-backup.sh', 'scripts/db-restore.sh', 'scripts/db-compare.sh']) {
      const result = spawnSync('bash', ['-n', path(script)]);
      expect(result.status, result.stderr.toString()).toBe(0);
    }
  });

  it('fails fast without configuration instead of dumping nothing', () => {
    const result = run('scripts/db-backup.sh');
    expect(result.status).not.toBe(0);
    expect(result.stderr.toString()).toMatch(/Missing required variable/);
  });

  it('runs at 06:00 Tashkent and keeps the newest 14 copies', () => {
    expect(read('.github/workflows/db-backup.yml')).toMatch(/cron: '0 1 \* \* \*'/);
    const script = read('scripts/db-backup.sh');
    expect(script).toMatch(/BACKUP_KEEP:-14/);
    expect(script).toMatch(/sort -r \| tail -n \+"\$\(\(keep \+ 1\)\)"/);
    expect(script).toMatch(/prune "\$prefix" "\$keep"/);
  });

  it('keeps one copy per month for the newest 24 months, separate from daily pruning', () => {
    const script = read('scripts/db-backup.sh');
    expect(script).toMatch(/BACKUP_KEEP_MONTHLY:-24/);
    expect(script).toMatch(/monthly_prefix="\$\{prefix\}\/monthly"/);
    expect(script).toMatch(/--prefix "\$\{monthly_prefix\}\/db-\$\{month\}"/);
    expect(script).toMatch(/prune "\$monthly_prefix" "\$keep_monthly"/);
    // Daily pruning matches only keys directly under the prefix, never monthly/ copies.
    expect(script).toMatch(/grep -E "\^\$\{dir\}\/db-/);
  });

  it('keeps the schedule alive in a separate job with only actions write access', () => {
    const flow = read('.github/workflows/db-backup.yml');
    expect(flow).toMatch(/^permissions:\n  contents: read$/m);
    expect(flow).toMatch(/keepalive:\n(?:    .*\n)*    permissions:\n      actions: write\n/);
    expect(flow).toMatch(/actions\/workflows\/db-backup\.yml\/enable/);
  });

  it('rejects an invalid copy count before dumping', () => {
    for (const keep of ['0', 'abc', '-3']) {
      const result = run('scripts/db-backup.sh', [], { ...configured, BACKUP_KEEP: keep });
      expect(result.status).not.toBe(0);
      expect(result.stderr.toString()).toMatch(/BACKUP_KEEP must be a positive whole number/);
      const monthly = run('scripts/db-backup.sh', [], { ...configured, BACKUP_KEEP_MONTHLY: keep });
      expect(monthly.status).not.toBe(0);
      expect(monthly.stderr.toString()).toMatch(/BACKUP_KEEP_MONTHLY must be a positive whole number/);
    }
  });

  it('encrypts dumps and passes secrets to the workflow only through env', () => {
    const script = read('scripts/db-backup.sh');
    const flow = read('.github/workflows/db-backup.yml');
    expect(script).toMatch(/age -r/);
    expect(script).not.toMatch(/pg_dump[^\n]*>\s*[^"$]/);
    expect(script).toMatch(/"\$\{PG_DUMP:-pg_dump\}"/);
    expect(script).toMatch(/game-club-finance\/db-backups/);
    expect(flow).toMatch(/runs-on: ubuntu-24\.04/);
    expect(flow).toMatch(/PG_DUMP: \/usr\/lib\/postgresql\/17\/bin\/pg_dump/);
    expect(flow).toMatch(/cron:/);
    expect(flow).toMatch(/workflow_dispatch/);
    expect(flow).toMatch(/if: failure\(\)/);
    expect(flow).not.toMatch(/run:[^\n]*\$\{\{\s*secrets\./);
  });

  it('keeps grants in the dump so a restore cannot reopen revoked access', () => {
    const script = read('scripts/db-backup.sh');
    expect(script).not.toMatch(/--no-privileges|--no-acl|\s-x\s/);
    expect(script).toMatch(/--schema=public --schema=auth/);
  });

  it('restores accounts before club data and keeps Supabase default grants from widening access', () => {
    const script = read('scripts/db-restore.sh');
    expect(script).not.toMatch(/--no-privileges|--clean/);
    expect(script).toMatch(/for table in users identities/);
    expect(script.indexOf('auth.list')).toBeLessThan(script.indexOf('app.list'));
    expect(script).toMatch(/grep -v ' DEFAULT ACL '/);
    expect(script).toMatch(/defaults revoke from\n/);
    expect(script).toMatch(/trap 'defaults grant to/);
    expect(script).toMatch(/use a new, empty project/);
    expect(script.match(/--single-transaction/g)).toHaveLength(2);
  });

  it('recreates every cron job the migrations schedule and none they retired', () => {
    const restoreSql = read('scripts/restore-cron-jobs.sql');
    const live = new Set<string>();
    for (const name of readdirSync(path('migrations')).filter((file) => file.endsWith('.sql')).sort()) {
      const sql = read(`migrations/${name}`);
      const scheduled = [...sql.matchAll(/cron\.schedule\(\s*'([^']+)'/g)].map((match) => match[1]);
      // A migration that unschedules a job without scheduling it again retires it.
      const unscheduled = [...sql.matchAll(/jobname = '([^']+)'/g)].map((match) => match[1]);
      for (const job of unscheduled) if (!scheduled.includes(job)) live.delete(job);
      for (const job of scheduled) live.add(job);
    }
    expect(live.size).toBeGreaterThan(0);
    for (const job of live) expect(restoreSql).toContain(`'${job}'`);
    expect(restoreSql).not.toContain("'finalize-monthly-average-income'");
  });

  it('requires both database URLs to compare', () => {
    const result = run('scripts/db-compare.sh', ['only-one']);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toString()).toMatch(/Usage/);
  });

  it('requires an identity file and both arguments to restore', () => {
    expect(run('scripts/db-restore.sh').status).not.toBe(0);
    const result = run('scripts/db-restore.sh', ['a', 'b']);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toString()).toMatch(/AGE_IDENTITY_FILE/);
  });
});
