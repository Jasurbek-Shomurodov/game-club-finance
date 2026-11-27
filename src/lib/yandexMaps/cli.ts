// Arguments of `npm run yandex:sync -- <command> [--club <id>] [--card-base-url <url>] [--photo-pictures] [--dry-run] [--confirm-send [--resend]]`
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
  /** `plan`: where the public price-card route is served; the items' pictures point there. */
  cardBaseUrl: string;
  /** `plan`: use the zone photo or logo as the pictures instead of the price cards. */
  photoPictures: boolean;
}

/** The public site's price-card route (src/app/api/showcase/price-card). */
/** The www host: the bare domain answers 308, which Yandex does not follow when it fetches pictures. */
export const DEFAULT_PRICE_CARD_BASE_URL = 'https://www.pixelgaming.uz/api/showcase/price-card';

export const YANDEX_SYNC_USAGE = 'Usage: npm run yandex:sync -- <plan|replies|report> [--club <club id>] [--card-base-url <https url>] [--photo-pictures] [--dry-run] [--confirm-send [--resend]]';

/** An https address without query or fragment, trailing slashes dropped; null otherwise. */
function cardBaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseYandexSyncArgs(argv: readonly string[]): { ok: true; args: YandexSyncArgs } | { ok: false; error: string } {
  const [command, ...rest] = argv;
  if (!YANDEX_SYNC_COMMANDS.includes(command as YandexSyncCommand)) return { ok: false, error: YANDEX_SYNC_USAGE };
  const args: YandexSyncArgs = {
    command: command as YandexSyncCommand, clubId: null, dryRun: false, confirmSend: false, resend: false,
    cardBaseUrl: DEFAULT_PRICE_CARD_BASE_URL, photoPictures: false,
  };
  let cardBaseUrlGiven = false;
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--confirm-send') args.confirmSend = true;
    else if (flag === '--resend') args.resend = true;
    else if (flag === '--photo-pictures') args.photoPictures = true;
    else if (flag === '--card-base-url') {
      const value = cardBaseUrl(rest[i + 1]);
      if (!value) return { ok: false, error: '--card-base-url needs an https address, e.g. https://www.pixelgaming.uz/api/showcase/price-card' };
      args.cardBaseUrl = value;
      cardBaseUrlGiven = true;
      i += 1;
    }
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
  if (args.command !== 'plan' && (cardBaseUrlGiven || args.photoPictures)) {
    return { ok: false, error: '--card-base-url and --photo-pictures only apply to plan' };
  }
  if (cardBaseUrlGiven && args.photoPictures) return { ok: false, error: 'Pass either --card-base-url or --photo-pictures, not both' };
  if (args.resend && !args.confirmSend) return { ok: false, error: '--resend needs --confirm-send' };
  if (args.dryRun && args.confirmSend) return { ok: false, error: 'Pass either --dry-run or --confirm-send, not both' };
  return { ok: true, args };
}
