import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/** The header Telegram sends with every webhook call when setWebhook was given a secret_token. */
export const OWNER_BOT_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * Telegram allows 1–256 characters of A–Z, a–z, 0–9, "_" and "-" for
 * secret_token; anything shorter than 16 is too easy to guess, so the route
 * treats it as not configured.
 */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

export function isValidOwnerBotWebhookSecret(secret: string | null | undefined): secret is string {
  return typeof secret === 'string' && SECRET_PATTERN.test(secret);
}

function secretMatches(received: string | null, secret: string): boolean {
  const expected = Buffer.from(secret);
  const actual = Buffer.from(received ?? '');
  // timingSafeEqual needs equal lengths; compare the secret with itself on a
  // mismatch so a wrong length costs the same as a full comparison.
  if (actual.length !== expected.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(actual, expected);
}

/** Checks a webhook call's X-Telegram-Bot-Api-Secret-Token against TELEGRAM_OWNER_BOT_WEBHOOK_SECRET. */
export function ownerBotWebhookAuthStatus(
  request: Request,
  secret = process.env.TELEGRAM_OWNER_BOT_WEBHOOK_SECRET,
): 'authorized' | 'unauthorized' | 'invalid_configuration' {
  if (!isValidOwnerBotWebhookSecret(secret)) return 'invalid_configuration';
  return secretMatches(request.headers.get(OWNER_BOT_SECRET_HEADER), secret) ? 'authorized' : 'unauthorized';
}
