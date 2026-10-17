import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { loadMigrationHealth, unrecordedMigrations } from './migrationHealth';
import manifest from './migrationManifest.json';

describe('migration health', () => {
  it('scopes a read-only diagnostic to the selected club and keeps unknown history distinct', async () => {
    const data = { historyAvailable: false, recordedVersions: [], checks: [
      { version: '051', name: 'withdraw_owner_money_for_month', status: 'different' },
    ] };
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    expect(await loadMigrationHealth({ rpc }, 'club-a')).toEqual({ status: 'ready', data });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_migration_health', { p_club_id: 'club-a' });
  });

  it.each(['PGRST202', '42883'])('identifies a missing diagnostic RPC (%s)', async (code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code } });
    expect(await loadMigrationHealth({ rpc }, 'club-a')).toEqual({ status: 'unavailable' });
  });

  it('does not report permission errors or malformed responses as missing migrations', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ error: { code: '42501' } })
      .mockResolvedValueOnce({ data: { recordedVersions: [] }, error: null })
      .mockRejectedValueOnce(new Error('offline'));
    for (let i = 0; i < 3; i++) expect(await loadMigrationHealth({ rpc }, 'club-a')).toEqual({ status: 'error' });
  });

  it('matches history records by the numeric filename prefix only', () => {
    const files = ['001_initial_schema.sql', '052_migration_health.sql', '084_daily_cash_entry_author_integrity.sql'];
    expect(unrecordedMigrations(files, ['001', '084'])).toEqual(['052_migration_health.sql']);
    expect(unrecordedMigrations(files, ['001', '052', '084', '999'])).toEqual([]);
    expect(unrecordedMigrations(files, ['1', '52', '084_daily_cash_entry_author_integrity'])).toEqual(files);
    expect(unrecordedMigrations(files, ['20260101000000'])).toEqual(files);
    expect(unrecordedMigrations(files, [])).toEqual(files);
  });

  it('lists every committed migration so new migrations require updating the manifest', () => {
    expect(manifest).toEqual(readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort());
  });

  it('requires a club owner and exposes only metadata with restricted execution', () => {
    const sql = readFileSync('migrations/052_migration_health.sql', 'utf8');
    expect(sql).toContain("auth.uid() is null");
    expect(sql).toContain("public.current_user_club_role(p_club_id) is distinct from 'owner'");
    expect(sql).toContain('set search_path = pg_catalog, public, pg_temp');
    expect(sql).toContain('revoke all on function public.get_migration_health(uuid) from public, anon');
    expect(sql).toContain("tgtype = 7");
    expect(sql).toContain("has_function_privilege('authenticated', proc.oid, 'EXECUTE')");
    expect(sql).not.toMatch(/\b(insert into|update public|delete from)\b/i);
    expect(sql).not.toContain('pg_get_functiondef');
  });

  it('fingerprints both 051 functions and the 050 snapshot against their actual migration bodies', () => {
    const sql = readFileSync('migrations/052_migration_health.sql', 'utf8');
    for (const [file, name] of [
      ['050_owner_profit_monthly_payment_balances.sql', 'get_owner_profit_snapshot'],
      ['051_custom_owner_withdrawals.sql', 'withdraw_owner_money_for_month'],
      ['051_custom_owner_withdrawals.sql', 'enforce_owner_withdrawal_month_balance'],
    ]) {
      const source = readFileSync(`migrations/${file}`, 'utf8');
      const body = new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`).exec(source)?.[1];
      expect(body).toBeDefined();
      expect(sql).toContain(createHash('md5').update(body!).digest('hex'));
    }
  });
});
