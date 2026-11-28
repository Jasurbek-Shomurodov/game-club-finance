/**
 * The owner money bot's link to an app user (docs/plans/owner-money-bot.md):
 * the bot's name from the build, the command an owner sends it and how the
 * linked account is named in Settings.
 */

/** Telegram bot usernames: 5 to 32 letters, digits or underscores, starting with a letter. */
const BOT_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

/** The configured bot's username without "@", or null when it is unset or not a Telegram username. */
export function ownerBotUsername(raw: string | null | undefined): string | null {
  const name = (raw ?? '').trim().replace(/^@/, '');
  return BOT_USERNAME.test(name) ? name : null;
}

/** The owner bot of this build (inlined by Next.js), or null while it is not set up: Settings then hides its card. */
export const OWNER_BOT_USERNAME = ownerBotUsername(process.env.NEXT_PUBLIC_TELEGRAM_OWNER_BOT_USERNAME);

/** The bot's page in Telegram. */
export function ownerBotUrl(username: string): string {
  return `https://t.me/${username}`;
}

/** What the owner sends the bot to link this account. */
export function ownerBotLinkCommand(code: string): string {
  return `/link ${code}`;
}

/** "@name" for a linked account with a username, otherwise null (the Settings card says "Telegram account"). */
export function telegramAccountName(username: string | null | undefined): string | null {
  const name = (username ?? '').trim().replace(/^@/, '');
  return name ? `@${name}` : null;
}

/** Only an owner of some club can link the owner bot (create_owner_telegram_link_code, 190). */
export function ownsAnyClub(memberships: ReadonlyArray<{ role: string | null | undefined }>): boolean {
  return memberships.some((membership) => membership.role === 'owner');
}
