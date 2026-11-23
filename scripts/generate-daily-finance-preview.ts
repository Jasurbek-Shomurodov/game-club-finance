import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { buildDailyFinanceTelegramReport } from '../src/lib/telegram/sendDailyFinanceReport';

function loadLocalEnvironment() {
  const contents = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const name = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).replace(/^['"]|['"]$/g, '');
    process.env[name] = value;
  }
}

async function main() {
  loadLocalEnvironment();

  const businessDate = process.argv[2] ?? '2026-08-27';
  const clubId = process.argv[3] ?? process.env.TELEGRAM_MAIN_CLUB_ID;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!clubId || !supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing preview club or Supabase environment configuration');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const report = await buildDailyFinanceTelegramReport(supabase, {
    businessDate,
    clubId,
    chatId: 'preview-only',
  });

  if (!report.imagePng) {
    throw new Error('PNG rendering failed; see the exact renderer error above');
  }

  const outputDirectory = resolve(process.cwd(), 'artifacts');
  const outputPath = resolve(outputDirectory, `game-club-finance-${businessDate}.png`);
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(outputPath, report.imagePng);
  console.log(outputPath);
  if (report.monthImage) {
    const monthPath = resolve(outputDirectory, `game-club-finance-month-${businessDate}.png`);
    writeFileSync(monthPath, report.monthImage.png);
    console.log(monthPath);
  }
  if (report.forecastImage) {
    const forecastPath = resolve(outputDirectory, `game-club-finance-forecast-${businessDate}.png`);
    writeFileSync(forecastPath, report.forecastImage.png);
    console.log(forecastPath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
