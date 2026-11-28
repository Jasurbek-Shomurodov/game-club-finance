import { isValidOwnerBotWebhookSecret } from './webhookAuth';

/**
 * The one-time webhook registration of the owner bot
 * (`npm run owner-bot:webhook`, docs/runbooks/owner-money-bot.md). The token
 * and secret come from the environment and never appear in what is printed.
 */

export const OWNER_BOT_DEFAULT_WEBHOOK_URL = 'https://admin.pixelgaming.uz/api/telegram/owner-bot';
/** Text messages now; button presses from slice 3 on. */
export const OWNER_BOT_ALLOWED_UPDATES = ['message', 'callback_query'] as const;

export interface OwnerBotWebhookArgs {
  command: 'set' | 'info';
  url: string;
  dropPending: boolean;
}

const USAGE = 'Usage: npm run owner-bot:webhook -- set [--url <https url>] [--drop-pending] | info';

export function parseOwnerBotWebhookArgs(argv: readonly string[]): OwnerBotWebhookArgs {
  const [command, ...rest] = argv;
  if (command !== 'set' && command !== 'info') throw new Error(USAGE);
  let url = OWNER_BOT_DEFAULT_WEBHOOK_URL;
  let dropPending = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--drop-pending') dropPending = true;
    else if (arg === '--url' && rest[index + 1]) url = rest[(index += 1)];
    else throw new Error(USAGE);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error('Telegram calls webhooks over https only.');
  if (parsed.username || parsed.password) throw new Error('The webhook URL must not carry credentials.');
  return { command, url: parsed.toString(), dropPending };
}

/** The setWebhook request body. */
export function setWebhookBody({ url, secret, dropPending }: { url: string; secret: string; dropPending: boolean }) {
  if (!isValidOwnerBotWebhookSecret(secret)) {
    throw new Error('TELEGRAM_OWNER_BOT_WEBHOOK_SECRET must be 16–256 characters of A–Z, a–z, 0–9, "_" or "-".');
  }
  return {
    url,
    secret_token: secret,
    allowed_updates: [...OWNER_BOT_ALLOWED_UPDATES],
    drop_pending_updates: dropPending,
  };
}

/** `text` with every given secret (8+ characters) replaced, for anything printed. */
export function redactSecrets(text: string, secrets: ReadonlyArray<string | null | undefined>): string {
  let safe = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) safe = safe.split(secret).join('[redacted]');
  }
  return safe;
}

/** The getWebhookInfo fields worth printing; Telegram never returns the secret token there. */
export function describeWebhookInfo(info: unknown): string[] {
  const value = (typeof info === 'object' && info !== null ? info : {}) as Record<string, unknown>;
  const lastError = typeof value.last_error_date === 'number'
    ? `${new Date(value.last_error_date * 1_000).toISOString()} ${String(value.last_error_message ?? '')}`.trim()
    : 'none';
  return [
    `url: ${typeof value.url === 'string' && value.url ? value.url : '(not set)'}`,
    `pending updates: ${Number(value.pending_update_count ?? 0)}`,
    `allowed updates: ${Array.isArray(value.allowed_updates) ? value.allowed_updates.join(', ') : '(all but chat_member)'}`,
    `last error: ${lastError}`,
  ];
}
