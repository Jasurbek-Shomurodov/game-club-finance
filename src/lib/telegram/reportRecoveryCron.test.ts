import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Telegram report recovery crons', () => {
  it('leaves primary scheduling to Supabase instead of Vercel Cron', () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
      crons?: Array<{ path: string; schedule: string }>;
    };

    expect(config.crons).toBeUndefined();
    const migration = readFileSync(
      resolve(process.cwd(), 'migrations/073_daily_report_cron_0800_tashkent.sql'),
      'utf8',
    );
    expect(migration).toContain("'game-club-daily-finance-report'");
    expect(migration).toContain("'0 3 * * *'");
  });

  it('keeps both recovery aliases routed through the primary ledger-backed handler', () => {
    for (const route of ['daily-finance-report-retry-1', 'daily-finance-report-retry-2']) {
      const path = resolve(process.cwd(), 'src/app/api/cron', route, 'route.ts');
      expect(existsSync(path)).toBe(true);
      const source = readFileSync(path, 'utf8');
      expect(source).toContain("from '../daily-finance-report/route'");
      expect(source).toContain('export const GET = handleDailyFinanceReport');
    }
  });
});
