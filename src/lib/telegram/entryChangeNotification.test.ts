import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('./sendDailyFinanceReport', () => ({ sendTelegramMessage: send }));

import {
  buildDayCollectedNotice,
  buildDayUncollectedNotice,
  buildExchangeDeletedNotice,
  buildExpenseChangedNotice,
  buildExpenseDeletedNotice,
  buildIncomeDeletedNotice,
  sendClubNotice,
} from './entryChangeNotification';

const expense = {
  amount: 5_500_000, category: 'electricity', comment: 'Mehrinoz', date: '2026-10-24', payment_method: 'cash', payment_source: 'game_club',
};

describe('entry change notices', () => {
  it('describes a deleted expense with its date, comment and who deleted it', () => {
    expect(buildExpenseDeletedNotice({ ...expense, payment_source: 'bar' }, 'Owner').split('\n')).toEqual([
      '🗑 Удалён расход: 5 500 000 сум',
      'Бар · Электричество · Наличные · 24 октября',
      '💬 Mehrinoz',
      'Удалил(а) Owner',
    ]);
  });

  it('shows the current expense and old → new only for what changed', () => {
    expect(buildExpenseChangedNotice(expense, { ...expense, payment_method: 'terminal', amount: 6_000_000 }, 'Owner').split('\n')).toEqual([
      '✏️ Изменён расход: 6 000 000 сум',
      'Игровой клуб · Электричество · Терминал · 24 октября',
      'Сумма: 5 500 000 сум → 6 000 000 сум',
      'Оплата: Наличные → Терминал',
      '💬 Mehrinoz',
      'Изменил(а) Owner',
    ]);
    const dateOnly = buildExpenseChangedNotice(expense, { ...expense, date: '2026-10-20' }, 'Owner');
    expect(dateOnly).toContain('Дата: 24 октября → 20 октября');
    expect(dateOnly).not.toContain('Оплата:');
    expect(dateOnly).not.toContain('Категория:');
    const categoryOnly = buildExpenseChangedNotice(expense, { ...expense, category: 'cleaning' }, 'Owner');
    expect(categoryOnly).toContain('Категория: Электричество → Уборка');
  });

  it('shows a changed comment as old → new', () => {
    const text = buildExpenseChangedNotice(expense, { ...expense, comment: null }, 'Owner');
    expect(text).toContain('Комментарий: Mehrinoz → —');
    expect(text).not.toContain('💬');
  });

  it('keeps the dollars of a dollar expense', () => {
    const usd = { ...expense, payment_method: 'usd', usd_amount: '100', usd_rate: '12850' };
    expect(buildExpenseDeletedNotice(usd, 'Owner')).toContain('$100 по курсу 12 850');
  });

  it('lists only the non-zero income methods with their total', () => {
    expect(buildIncomeDeletedNotice({
      date: '2026-10-24', cash_income: 2_134_000, terminal_income: 0, card_income: null, playstation_income: 150_000,
    }, 'Owner').split('\n')).toEqual([
      '🗑 Удалена выручка: 2 284 000 сум',
      'Наличные 2 134 000 · PlayStation 150 000 · 24 октября',
      'Удалил(а) Owner',
    ]);
  });

  it('describes a deleted exchange in both currencies', () => {
    expect(buildExchangeDeletedNotice({
      date: '2026-10-24', from_method: 'cash', to_method: 'usd', from_amount: '1280000', to_amount: '100', comment: 'сейф',
    }, 'Owner').split('\n')).toEqual([
      '🗑 Удалён обмен: 1 280 000 сум → $100',
      'Наличные → Доллары · 24 октября',
      '💬 сейф',
      'Удалил(а) Owner',
    ]);
  });

  it('announces a collected or reopened day on one line', () => {
    expect(buildDayCollectedNotice('2026-11-14', 'Owner')).toBe('✅ День собран: 14 ноября · Owner');
    expect(buildDayUncollectedNotice('2026-11-14', 'Owner')).toBe('↩️ День снова открыт: 14 ноября · Owner');
  });
});

describe('sendClubNotice', () => {
  const CLUB = 'club-main';
  beforeEach(() => {
    send.mockReset();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
    vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', CLUB);
    vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '-1001');
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('posts to the club group only', async () => {
    send.mockResolvedValue({});
    await expect(sendClubNotice(CLUB, 'text', {})).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith({ botToken: 'bot-token', chatId: '-1001', text: 'text' });
    await expect(sendClubNotice('another-club', 'text', {})).resolves.toBe(false);
    expect(send).toHaveBeenCalledOnce();
  });

  it('never throws when Telegram fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    send.mockRejectedValue(new Error('down'));
    await expect(sendClubNotice(CLUB, 'text', { entryId: 'e1' })).resolves.toBe(false);
  });
});
