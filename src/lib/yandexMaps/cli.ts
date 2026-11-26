// Arguments of `npm run yandex:sync -- <command> [--club <id>] [--dry-run] [--confirm-send [--resend]]`
// (scripts/yandex-maps-sync.ts). Pure, so the rules are tested.

export const YANDEX_SYNC_COMMANDS = ['plan', 'replies', 'report'] as const;
export type YandexSyncCommand = (typeof YANDEX_SYNC_COMMANDS)[number];

export interface YandexSyncArgs {
  command: YandexSyncCommand;
  /** Only this club; every club with a Yandex Maps place when null. */
  clubId: string | null;
  /** `report`: write the images, send nothing. */
  dryRun: boolean;
  /** `report`: required to send to Telegram. */
  confirmSend: boolean;
  /** `report --confirm-send`: send again although this business date was already sent. */
  resend: boolean;
}

export const YANDEX_SYNC_USAGE = 'Usage: npm run yandex:sync -- <plan|replies|report> [--club <club id>] [--dry-run] [--confirm-send [--resend]]';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseYandexSyncArgs(argv: readonly string[]): { ok: true; args: YandexSyncArgs } | { ok: false; error: string } {
  const [command, ...rest] = argv;
  if (!YANDEX_SYNC_COMMANDS.includes(command as YandexSyncCommand)) return { ok: false, error: YANDEX_SYNC_USAGE };
  const args: YandexSyncArgs = { command: command as YandexSyncCommand, clubId: null, dryRun: false, confirmSend: false, resend: false };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--confirm-send') args.confirmSend = true;
    else if (flag === '--resend') args.resend = true;
    else if (flag === '--club') {
      const value = rest[i + 1];
      if (!value || !UUID.test(value)) return { ok: false, error: '--club needs a club id (uuid)' };
      args.clubId = value.toLowerCase();
      i += 1;
    } else return { ok: false, error: `Unknown option ${flag}. ${YANDEX_SYNC_USAGE}` };
  }
  if (args.command === 'report' && !args.dryRun && !args.confirmSend) {
    return { ok: false, error: 'report sends to the clubs\' Telegram groups: pass --dry-run to only write the images, or --confirm-send to send them' };
  }
  if (args.command !== 'report' && (args.dryRun || args.confirmSend || args.resend)) {
    return { ok: false, error: '--dry-run, --confirm-send and --resend only apply to report' };
  }
  if (args.resend && !args.confirmSend) return { ok: false, error: '--resend needs --confirm-send' };
  if (args.dryRun && args.confirmSend) return { ok: false, error: 'Pass either --dry-run or --confirm-send, not both' };
  return { ok: true, args };
}
