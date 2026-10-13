import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'migrations/041_supabase_daily_report_cron_and_delivery_audit.sql'),
  'utf8',
);
const senderSource = readFileSync(
  resolve(process.cwd(), 'src/lib/telegram/sendDailyFinanceReport.ts'),
  'utf8',
);
const vercelConfig = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));

describe('daily finance image deployment configuration', () => {
  it('statically imports the renderer so Vercel traces sharp', () => {
    expect(senderSource).toMatch(
      /import \{ renderDailyFinanceReportPng \} from '\.\/dailyFinanceReportImage';/,
    );
    expect(senderSource).not.toMatch(/await import\('\.\/dailyFinanceReportImage'\)/);
  });

  it('bundles Linux libvips and application-owned Noto Sans files with the route', () => {
    expect(vercelConfig.functions['src/app/api/cron/daily-finance-report/route.ts'].includeFiles)
      .toBe('{node_modules/@img/sharp-libvips-linux-x64/**,src/assets/fonts/*.ttf}');
  });
});

describe('Supabase daily finance report cron', () => {
  it('runs at 08:00 Asia/Tashkent using the equivalent 03:00 UTC schedule', () => {
    const reschedule = readFileSync(
      resolve(process.cwd(), 'migrations/073_daily_report_cron_0800_tashkent.sql'),
      'utf8',
    );
    expect(reschedule).toContain("'game-club-daily-finance-report'");
    expect(reschedule).toContain("'0 3 * * *'");
    expect(reschedule).toContain('03:00 UTC is 08:00 in Asia/Tashkent');
    expect(reschedule).toContain("where jobname = 'game-club-daily-finance-report'");
    expect(reschedule).toContain('perform cron.unschedule(existing_job_id)');
    expect(readFileSync(resolve(process.cwd(), 'scripts/restore-cron-jobs.sql'), 'utf8'))
      .toContain("'0 3 * * *'");
  });

  it('loads the Bearer secret from Vault and invokes only production', () => {
    expect(migration).toContain('from vault.decrypted_secrets');
    expect(migration).toContain("name = 'game_club_daily_report_cron_secret'");
    expect(migration).toContain("'Authorization', 'Bearer ' || cron_secret");
    expect(migration).toContain(
      "url := 'https://game-club-finance.vercel.app/api/cron/daily-finance-report'",
    );
    expect(migration).not.toMatch(/CRON_SECRET\s*=/);
  });

  it('keeps invocation private and replaces the named job idempotently', () => {
    expect(migration).toMatch(
      /revoke all on function public\.invoke_game_club_daily_finance_report\(\)[\s\S]*from public, anon, authenticated;/,
    );
    expect(migration).toContain("where jobname = 'game-club-daily-finance-report'");
    expect(migration).toContain('perform cron.unschedule(existing_job_id)');
    expect(migration).toContain('perform cron.schedule(');
  });

  it('records message, chat, attempt, sent status, actual format, and errors', () => {
    expect(migration).toContain('attempted_at timestamptz');
    expect(migration).toContain('telegram_chat_id bigint');
    expect(migration).toContain('telegram_message_id bigint');
    expect(migration).toContain('delivery_format text');
    expect(migration).toContain("new.status = 'sent'");
    expect(migration).toContain("telegram_result ->> 'messageId'");
  });
});
