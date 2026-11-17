import { describe, expect, it } from 'vitest';
import { buildReserveEntryDeletedNotice, buildReserveMoveNotice } from './reserveNotification';

describe('reserve notices', () => {
  it('names the month a deposit left and splits a multi-method deposit', () => {
    expect(buildReserveMoveNotice({
      kind: 'deposit',
      month: '2026-10',
      source: 'game_club',
      parts: [{ method: 'cash', amount: 649_200 }, { method: 'playstation', amount: 210_000 }],
      comment: null,
      by: 'Jasurbek',
    })).toBe([
      '🏦 В резерв: 859 200 сум',
      'Игровой клуб · Наличные 649 200 · PlayStation 210 000 · из прибыли за октябрь 2026',
      'Jasurbek',
    ].join('\n'));
  });

  it('shows a single method, a Bar move without one, and the comment after the author', () => {
    expect(buildReserveMoveNotice({
      kind: 'deposit', month: '2026-11', source: 'game_club', parts: [{ method: 'cash', amount: 500_000 }], comment: 'For new PCs', by: 'Ali',
    })).toBe('🏦 В резерв: 500 000 сум\nИгровой клуб · Наличные · из прибыли за ноябрь 2026\nAli: For new PCs');
    expect(buildReserveMoveNotice({
      kind: 'return', month: '2026-11', source: 'bar', parts: [{ method: null, amount: 120_000 }], comment: null, by: 'Ali',
    })).toBe('↩️ Из резерва в прибыль: 120 000 сум\nБар · в прибыль за ноябрь 2026\nAli');
  });

  it('says where the money of a deleted entry went back to', () => {
    expect(buildReserveEntryDeletedNotice({
      kind: 'deposit', period_month: '2026-10-01', source: 'game_club', payment_method: 'cash', amount: '649200', comment: null,
    }, 'Ali')).toBe('🗑 Удалено внесение в резерв: 649 200 сум\nИгровой клуб · Наличные · деньги вернулись в прибыль за октябрь 2026\nУдалил(а) Ali');
    expect(buildReserveEntryDeletedNotice({
      kind: 'return', period_month: '2026-11-01', source: 'bar', payment_method: null, amount: 120_000, comment: 'mistake',
    }, 'Ali')).toBe('🗑 Удалено возвращение из резерва: 120 000 сум\nБар · деньги вернулись в резерв из прибыли за ноябрь 2026\n💬 mistake\nУдалил(а) Ali');
  });
});
