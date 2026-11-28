import { describe, expect, it } from 'vitest';
import { ownerBotLinkCommand, ownerBotUrl, ownerBotUsername, ownsAnyClub, telegramAccountName } from './ownerTelegramLink';

describe('ownerBotUsername', () => {
  it('accepts a Telegram bot username with or without "@"', () => {
    expect(ownerBotUsername('PixelOwnerBot')).toBe('PixelOwnerBot');
    expect(ownerBotUsername(' @pixel_owner_bot ')).toBe('pixel_owner_bot');
  });

  it('is null when unset or not a Telegram username', () => {
    expect(ownerBotUsername(undefined)).toBeNull();
    expect(ownerBotUsername('')).toBeNull();
    expect(ownerBotUsername('bot')).toBeNull();
    expect(ownerBotUsername('1pixel_bot')).toBeNull();
    expect(ownerBotUsername('pixel bot')).toBeNull();
    expect(ownerBotUsername('https://t.me/pixel_bot')).toBeNull();
    expect(ownerBotUsername('a'.repeat(33))).toBeNull();
  });
});

describe('owner bot link helpers', () => {
  it('builds the bot page and the /link command', () => {
    expect(ownerBotUrl('PixelOwnerBot')).toBe('https://t.me/PixelOwnerBot');
    expect(ownerBotLinkCommand('ABCD2345')).toBe('/link ABCD2345');
  });

  it('names a linked account by its username when it has one', () => {
    expect(telegramAccountName('pixel_owner')).toBe('@pixel_owner');
    expect(telegramAccountName('@pixel_owner')).toBe('@pixel_owner');
    expect(telegramAccountName(null)).toBeNull();
    expect(telegramAccountName('  ')).toBeNull();
  });

  it('lets only an owner of some club link the bot', () => {
    expect(ownsAnyClub([{ role: 'admin' }, { role: 'owner' }])).toBe(true);
    expect(ownsAnyClub([{ role: 'admin' }, { role: 'viewer' }])).toBe(false);
    expect(ownsAnyClub([])).toBe(false);
  });
});
