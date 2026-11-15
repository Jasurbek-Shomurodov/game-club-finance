import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCashShortageNotification } from './cashShortageNotification';
import { ownerChatId, targetChatId } from './clubChat';

describe('buildCashShortageNotification', () => {
  it('names the money, the reason, who is responsible and what is still lost', () => {
    expect(buildCashShortageNotification({
      addedBy: 'Jasurbek', date: '2026-11-11', source: 'game_club', method: 'cash', amount: 300_000,
      reason: 'stolen', employee: 'Izzat', recovered: 100_000, comment: 'Не хватило при вечерней сдаче смены',
    }).split('\n')).toEqual([
      '⚠️ Недостача: 300 000 сум',
      'Игровой клуб · Наличные · 11 ноября',
      'Украдено · ответственный: Izzat',
      'Удержано из зарплаты 100 000 · потеряно 200 000 сум',
      'Jasurbek: Не хватило при вечерней сдаче смены',
    ]);
  });

  it('has no recovery line when nothing was taken back', () => {
    const text = buildCashShortageNotification({
      addedBy: 'A', date: '2026-11-11', source: 'bar', method: 'terminal', amount: 50_000,
      reason: 'unknown', employee: null, recovered: 0, comment: 'Терминал не сошёлся с кассой бара',
    });
    expect(text).toContain('Бар · Терминал · 11 ноября');
    expect(text).toContain('Причина неизвестна · ответственный неизвестен');
    expect(text).not.toContain('Удержано');
  });
});

describe('ownerChatId', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses only the owners group and never the club group admins read', () => {
    vi.stubEnv('TELEGRAM_PIXEL_CLUB_ID', 'club-1');
    vi.stubEnv('TELEGRAM_PIXEL_CHAT_ID', '-100club');
    vi.stubEnv('TELEGRAM_PIXEL_OWNER_CHAT_ID', '');
    expect(targetChatId('club-1')).toBe('-100club');
    expect(ownerChatId('club-1')).toBeNull();
    vi.stubEnv('TELEGRAM_PIXEL_OWNER_CHAT_ID', '-100owners');
    expect(ownerChatId('club-1')).toBe('-100owners');
    expect(ownerChatId('other-club')).toBeNull();
  });
});
