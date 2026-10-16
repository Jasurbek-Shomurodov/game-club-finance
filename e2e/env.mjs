// `next build` and `next start` read .env.local and the other env files, which hold real keys (Supabase, Telegram,
// the cron secret, the assistant). Every key they name is blanked for the test build and server, so a run never
// reaches a real service.
import fs from 'node:fs';

export function blankedEnv() {
  const files = ['.env', '.env.local', '.env.production', '.env.production.local'].filter(file => fs.existsSync(file));
  const keys = files.flatMap(file => fs.readFileSync(file, 'utf8').split('\n')).map(line => line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1]).filter(Boolean);
  return Object.fromEntries(keys.map(key => [key, '']));
}
