export type TelegramReportTargetKey = 'pixel' | 'main' | 'bunker';

/** The single list of Telegram targets and the env vars that configure them. */
export const TELEGRAM_REPORT_TARGET_ENV: ReadonlyArray<{
  key: TelegramReportTargetKey;
  chatEnvName: string;
  clubEnvName: string;
}> = [
  { key: 'pixel', chatEnvName: 'TELEGRAM_PIXEL_CHAT_ID', clubEnvName: 'TELEGRAM_PIXEL_CLUB_ID' },
  { key: 'main', chatEnvName: 'TELEGRAM_MAIN_CHAT_ID', clubEnvName: 'TELEGRAM_MAIN_CLUB_ID' },
  { key: 'bunker', chatEnvName: 'TELEGRAM_BUNKER_CHAT_ID', clubEnvName: 'TELEGRAM_BUNKER_CLUB_ID' },
];

export function isTelegramReportTargetKey(value: string): value is TelegramReportTargetKey {
  return TELEGRAM_REPORT_TARGET_ENV.some((target) => target.key === value);
}

/**
 * Owners-only Telegram group per target, for messages admins must not see
 * (cash shortages). Optional: without one, such messages are not sent at all.
 */
const OWNER_CHAT_ENV: Readonly<Record<TelegramReportTargetKey, string>> = {
  pixel: 'TELEGRAM_PIXEL_OWNER_CHAT_ID',
  main: 'TELEGRAM_MAIN_OWNER_CHAT_ID',
  bunker: 'TELEGRAM_BUNKER_OWNER_CHAT_ID',
};

/** The club's owners-only group, or null. Never falls back to the club group, which admins read. */
export function ownerChatId(clubId: string): string | null {
  for (const { key, clubEnvName } of TELEGRAM_REPORT_TARGET_ENV) {
    if (process.env[clubEnvName] === clubId) return process.env[OWNER_CHAT_ENV[key]]?.trim() || null;
  }
  return null;
}

/**
 * Staff group per target, shared by several branches, for the bonuses and
 * fines staff should see (and their deletions). Optional: without one those
 * notices stay in the club group.
 */
const STAFF_CHAT_ENV: Readonly<Record<TelegramReportTargetKey, string>> = {
  pixel: 'TELEGRAM_PIXEL_STAFF_CHAT_ID',
  main: 'TELEGRAM_MAIN_STAFF_CHAT_ID',
  bunker: 'TELEGRAM_BUNKER_STAFF_CHAT_ID',
};

/** The club's staff group, or null when none is configured (callers then use the club group). */
export function staffChatId(clubId: string): string | null {
  for (const { key, clubEnvName } of TELEGRAM_REPORT_TARGET_ENV) {
    if (process.env[clubEnvName] === clubId) return process.env[STAFF_CHAT_ENV[key]]?.trim() || null;
  }
  return null;
}

/** Telegram group configured for a club, or null when the club has none. */
export function targetChatId(clubId: string): string | null {
  for (const { clubEnvName, chatEnvName } of TELEGRAM_REPORT_TARGET_ENV) {
    if (process.env[clubEnvName] === clubId) return process.env[chatEnvName] ?? null;
  }
  return null;
}

/** Where a record's own announcement was posted (stored beside the record, user-writable under RLS). */
export interface TelegramMessageCoordinates {
  telegram_chat_id: string | number | null;
  telegram_message_id: string | number | null;
}

/**
 * The announcement a follow-up notice may reply to, or null. Only a message
 * in the club's own configured group qualifies: the stored chat id is not
 * trusted, so a forged one never makes the bot point at another chat.
 */
export function clubMessageToReplyTo(clubId: string, coordinates: TelegramMessageCoordinates | null | undefined): number | null {
  return messageToReplyToIn(targetChatId(clubId), coordinates);
}

/**
 * The announcement a follow-up notice going to `chatId` may reply to, or null.
 * `chatId` is the configured chat the notice is sent to; a stored chat id
 * that differs (another chat, or a forged one) never qualifies.
 */
export function messageToReplyToIn(chatId: string | null, coordinates: TelegramMessageCoordinates | null | undefined): number | null {
  if (!chatId || !coordinates || coordinates.telegram_chat_id === null || String(coordinates.telegram_chat_id) !== chatId) return null;
  const messageId = Number(coordinates.telegram_message_id);
  return Number.isSafeInteger(messageId) && messageId > 0 ? messageId : null;
}
