import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('./sendDailyFinanceReport', () => ({ sendTelegramMessage: send }));

import {
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
  it('describes a deleted expense with who deleted it', () => {
    expect(buildExpenseDeletedNotice({ ...expense, payment_source: 'bar' }, 'Owner').split('\n')).toEqual([
      '🗑 Удалён расход',
      '',
      'Сумма: 5 500 000 сум',
      'Категория: Электричество',
      'Источник: Бар',
      'Способ оплаты: Наличные',
      'Дата: 24 октября',
      'Удалил(а): Owner',
      'Комментарий: Mehrinoz',
    ]);
  });

  it('shows old → new only for what changed', () => {
    const methodOnly = buildExpenseChangedNotice(expense, { ...expense, payment_method: 'terminal' }, 'Owner');
    expect(methodOnly).toContain('Способ оплаты: Наличные → Терминал');
    expect(methodOnly).toContain('Дата: 24 октября\n');
    const dateOnly = buildExpenseChangedNotice(expense, { ...expense, date: '2026-10-20' }, 'Owner');
    expect(dateOnly).toContain('Способ оплаты: Наличные\n');
    expect(dateOnly).toContain('Дата: 24 октября → 20 октября');
    expect(dateOnly).toContain('Изменил(а): Owner');
  });

  it('lists only the non-zero income methods with their total', () => {
    expect(buildIncomeDeletedNotice({
      date: '2026-10-24', cash_income: 2_134_000, terminal_income: 0, card_income: null, playstation_income: 150_000,
    }, 'Owner').split('\n')).toEqual([
      '🗑 Удалена выручка клуба',
      '',
      'Наличные: 2 134 000 сум',
      'PlayStation: 150 000 сум',
      'Итого: 2 284 000 сум',
      'Дата: 24 октября',
      'Удалил(а): Owner',
    ]);
  });

  it('describes a deleted exchange in both currencies', () => {
    const text = buildExchangeDeletedNotice({
      date: '2026-10-24', from_method: 'cash', to_method: 'usd', from_amount: '1280000', to_amount: '100', comment: null,
    }, 'Owner');
    expect(text).toContain('Из: Наличные — 1 280 000 сум');
    expect(text).toContain('В: Доллары — $100');
    expect(text).not.toContain('Комментарий');
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
