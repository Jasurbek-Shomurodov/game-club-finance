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

/** Telegram group configured for a club, or null when the club has none. */
export function targetChatId(clubId: string): string | null {
  for (const { clubEnvName, chatEnvName } of TELEGRAM_REPORT_TARGET_ENV) {
    if (process.env[clubEnvName] === clubId) return process.env[chatEnvName] ?? null;
  }
  return null;
}
