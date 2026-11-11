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

/** Telegram group configured for a club, or null when the club has none. */
export function targetChatId(clubId: string): string | null {
  for (const { clubEnvName, chatEnvName } of TELEGRAM_REPORT_TARGET_ENV) {
    if (process.env[clubEnvName] === clubId) return process.env[chatEnvName] ?? null;
  }
  return null;
}
