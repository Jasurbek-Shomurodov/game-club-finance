import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadMigrationHealth, loadProbeResults, migrationStatuses } from './migrationHealth';

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

  it('derives each status from probes first and history only for migrations with nothing to probe', () => {
    const manifest = [
      { file: '001_a.sql', probes: [1, 2] },
      { file: '002_b.sql', probes: [] },
      { file: '003_c.sql', probes: [3, 4] },
      { file: '004_d.sql', probes: [5] },
      { file: '005_e.sql', probes: [] },
    ];
    const status = (recorded: string[], results: boolean[] | null) =>
      migrationStatuses(manifest, recorded, results).map((s) => s.status);
    expect(status([], [true, true, true, false, false])).toEqual(['applied', 'likely', 'partial', 'notApplied', 'unknown']);
    expect(status(['005'], [true, true, true, true, true])).toEqual(['applied', 'likely', 'applied', 'applied', 'applied']);
    // Probes outrank history: a recorded migration whose objects are gone is not applied.
    expect(status(['004'], [true, true, true, true, false])).toEqual(['applied', 'likely', 'applied', 'notApplied', 'unknown']);
    // Without the probe RPC only history speaks, and nothing is inferred.
    expect(status(['1', '002', '20260101000000'], null)).toEqual(['unknown', 'applied', 'unknown', 'unknown', 'unknown']);
  });

  it('sends every manifest probe once and requires one boolean per probe', async () => {
    const manifest = [{ file: '001_a.sql', probes: [{ kind: 'relation', name: 'public.a' }] }, { file: '002_b.sql', probes: [] }];
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [true], error: null })
      .mockResolvedValueOnce({ data: [true, false], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
      .mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    expect(await loadProbeResults({ rpc }, 'club-a', manifest)).toEqual({ status: 'ready', results: [true] });
    expect(rpc).toHaveBeenCalledWith('get_migration_probe_results', { p_club_id: 'club-a', p_probes: [{ kind: 'relation', name: 'public.a' }] });
    expect(await loadProbeResults({ rpc }, 'club-a', manifest)).toEqual({ status: 'error' });
    expect(await loadProbeResults({ rpc }, 'club-a', manifest)).toEqual({ status: 'unavailable' });
    expect(await loadProbeResults({ rpc }, 'club-a', manifest)).toEqual({ status: 'error' });
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
