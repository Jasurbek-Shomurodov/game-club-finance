// Registers (or shows) the owner money bot's webhook with Telegram, once per
// bot or after the URL or secret changes (docs/runbooks/owner-money-bot.md):
//
//   npm run owner-bot:webhook -- set [--url <https url>] [--drop-pending]
//   npm run owner-bot:webhook -- info
//
// Reads TELEGRAM_OWNER_BOT_TOKEN and TELEGRAM_OWNER_BOT_WEBHOOK_SECRET from the
// environment, or from .env.local when they are not set there. Neither value
// is ever printed: Telegram's answers are shown with both blanked out.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  describeWebhookInfo,
  parseOwnerBotWebhookArgs,
  redactSecrets,
  setWebhookBody,
} from '../src/lib/telegram/ownerBot/webhookSetup';

const NAMES = ['TELEGRAM_OWNER_BOT_TOKEN', 'TELEGRAM_OWNER_BOT_WEBHOOK_SECRET'] as const;

/** Fills the two owner bot values from .env.local when the environment does not have them. */
function loadFromEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf('=');
    if (!trimmed || trimmed.startsWith('#') || separator < 1) continue;
    const name = trimmed.slice(0, separator);
    if ((NAMES as readonly string[]).includes(name) && !process.env[name]) {
      process.env[name] = trimmed.slice(separator + 1).replace(/^['"]|['"]$/g, '');
    }
  }
}

async function callTelegram(token: string, method: string, body?: unknown): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return await response.json().catch(() => ({ ok: false, description: `HTTP ${response.status}` })) as { ok: boolean; result?: unknown; description?: string };
}

async function main() {
  const args = parseOwnerBotWebhookArgs(process.argv.slice(2));
  loadFromEnvLocal();
  const token = process.env.TELEGRAM_OWNER_BOT_TOKEN;
  const secret = process.env.TELEGRAM_OWNER_BOT_WEBHOOK_SECRET;
  if (!token) throw new Error('TELEGRAM_OWNER_BOT_TOKEN is not set.');
  const safe = (text: string) => redactSecrets(text, [token, secret]);

  if (args.command === 'set') {
    if (!secret) throw new Error('TELEGRAM_OWNER_BOT_WEBHOOK_SECRET is not set.');
    const answer = await callTelegram(token, 'setWebhook', setWebhookBody({ url: args.url, secret, dropPending: args.dropPending }));
    if (!answer.ok) throw new Error(`setWebhook refused: ${answer.description ?? 'no description'}`);
    console.log(safe(`setWebhook: ${answer.description ?? 'ok'}`));
  }

  const info = await callTelegram(token, 'getWebhookInfo');
  if (!info.ok) throw new Error(`getWebhookInfo refused: ${info.description ?? 'no description'}`);
  for (const line of describeWebhookInfo(info.result)) console.log(safe(line));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redactSecrets(message, [process.env.TELEGRAM_OWNER_BOT_TOKEN, process.env.TELEGRAM_OWNER_BOT_WEBHOOK_SECRET]));
  process.exitCode = 1;
});
