import { describe, expect, it } from 'vitest';
import { parseOwnerBotCommand } from './commands';

describe('parseOwnerBotCommand', () => {
  it('reads /link with its code, with or without the bot name', () => {
    expect(parseOwnerBotCommand('/link ABCD2345')).toEqual({ kind: 'link', code: 'ABCD2345' });
    expect(parseOwnerBotCommand('  /link@pixel_owner_bot   abcd-2345 ')).toEqual({ kind: 'link', code: 'abcd-2345' });
    expect(parseOwnerBotCommand('/LINK\nABCD2345')).toEqual({ kind: 'link', code: 'ABCD2345' });
    expect(parseOwnerBotCommand('/link')).toEqual({ kind: 'link', code: null });
    expect(parseOwnerBotCommand('/link    ')).toEqual({ kind: 'link', code: null });
  });

  it('reads the deep-link payload of /start as a code', () => {
    expect(parseOwnerBotCommand('/start')).toEqual({ kind: 'start', code: null });
    expect(parseOwnerBotCommand('/start ABCD2345')).toEqual({ kind: 'start', code: 'ABCD2345' });
  });

  it('caps a long argument', () => {
    const command = parseOwnerBotCommand(`/link ${'A'.repeat(500)}`);
    expect(command).toEqual({ kind: 'link', code: 'A'.repeat(32) });
  });

  it('reads the other commands and ignores their arguments', () => {
    expect(parseOwnerBotCommand('/clubs')).toEqual({ kind: 'clubs' });
    expect(parseOwnerBotCommand('/today please')).toEqual({ kind: 'today' });
    expect(parseOwnerBotCommand('/today@pixel_owner_bot')).toEqual({ kind: 'today' });
    expect(parseOwnerBotCommand('/help')).toEqual({ kind: 'help' });
  });

  it('treats anything else as unknown', () => {
    for (const text of ['hello', '/withdraw 100', 'link ABCD2345', '/', '/to-day', '']) {
      expect(parseOwnerBotCommand(text)).toEqual({ kind: 'unknown' });
    }
  });
});
