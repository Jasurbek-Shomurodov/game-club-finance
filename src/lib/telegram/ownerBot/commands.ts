/**
 * Owner bot commands. `/start <code>` is the deep link t.me/<bot>?start=<code>
 * and redeems the code like `/link <code>`. A command may carry the bot's
 * name (`/today@pixel_owner_bot`), as Telegram's command menu sends it.
 */
export type OwnerBotCommand =
  | { kind: 'start'; code: string | null }
  | { kind: 'link'; code: string | null }
  | { kind: 'clubs' }
  | { kind: 'today' }
  | { kind: 'help' }
  | { kind: 'unknown' };

/** Longest code argument kept; real codes are 8 characters (190), the database normalises spaces and dashes. */
const MAX_CODE_LENGTH = 32;

const COMMAND = /^\/([A-Za-z_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/;

function codeArgument(rest: string | undefined): string | null {
  const code = (rest ?? '').trim();
  if (!code) return null;
  return code.slice(0, MAX_CODE_LENGTH);
}

export function parseOwnerBotCommand(text: string): OwnerBotCommand {
  const match = COMMAND.exec(text.trim());
  if (!match) return { kind: 'unknown' };
  const [, name, rest] = match;
  switch (name.toLowerCase()) {
    case 'start':
      return { kind: 'start', code: codeArgument(rest) };
    case 'link':
      return { kind: 'link', code: codeArgument(rest) };
    case 'clubs':
      return { kind: 'clubs' };
    case 'today':
      return { kind: 'today' };
    case 'help':
      return { kind: 'help' };
    default:
      return { kind: 'unknown' };
  }
}
