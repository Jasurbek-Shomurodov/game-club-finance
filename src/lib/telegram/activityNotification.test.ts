import { describe, expect, it } from 'vitest';
import {
  activityAuthor,
  buildActivityNotice,
  buildActivityNotices,
  mergeActivityRows,
  type ActivityAction,
  type ActivityAuditRow,
  type ActivityLookups,
} from './activityNotification';

const OWNER = 'user-owner';
const ADMIN = 'user-admin';

const lookups: ActivityLookups = {
  people: new Map([[OWNER, 'Jasur'], [ADMIN, 'Aziz'], ['user-new', 'Dilnoza']]),
  products: new Map([['prod-1', 'Cola'], ['prod-2', 'Pepsi']]),
  employees: new Map([['emp-1', 'Izzat']]),
  debts: new Map([['debt-1', 'Bekzod']]),
  shortages: new Map([
    ['short-1', { amount: 50_000, date: '2026-11-20', created_at: '2026-11-20T10:00:00.000000+00:00' }],
  ]),
};

let nextId = 1;
function log(
  table: string,
  action: ActivityAction,
  oldRow: Record<string, unknown> | null,
  newRow: Record<string, unknown> | null,
  options: { rowId?: string | null; by?: string | null; id?: number } = {},
): ActivityAuditRow {
  return {
    id: options.id ?? nextId++,
    club_id: 'club-1',
    table_name: table,
    row_id: options.rowId === undefined ? String((newRow ?? oldRow)?.id ?? 'row-1') : options.rowId,
    action,
    old_row: oldRow,
    new_row: newRow,
    changed_by: options.by === undefined ? OWNER : options.by,
    changed_at: '2026-11-24T10:00:00Z',
    changed_on: '2026-11-24',
  };
}

const text = (...rows: ActivityAuditRow[]) => buildActivityNotices(rows, lookups).map((notice) => notice.text);
const one = (...rows: ActivityAuditRow[]) => {
  const notices = buildActivityNotices(rows, lookups);
  expect(notices).toHaveLength(1);
  return notices[0];
};

const product = {
  id: 'prod-1', name: 'Cola', category: 'Напитки', sale_price: 12000, cost_price: 8000.5,
  low_stock_threshold: null, is_active: true, is_deleted: false, current_stock: 10, sort_order: 1,
};

describe('mergeActivityRows', () => {
  it('joins later edits of one record by the same person into one before → after change', () => {
    const changes = mergeActivityRows([
      log('club_memberships', 'update', { role: 'admin', feature_access: null }, { role: 'admin', feature_access: ['reports'] }, { rowId: 'u1', id: 1 }),
      log('products', 'update', product, { ...product, name: 'Coca-Cola' }, { id: 2 }),
      log('club_memberships', 'update', { role: 'admin', feature_access: ['reports'] }, { role: 'admin', feature_access: ['reports', 'debts'] }, { rowId: 'u1', id: 3 }),
    ]);
    expect(changes.map((item) => [item.table, item.rows.map((row) => row.id)])).toEqual([
      ['club_memberships', [1, 3]],
      ['products', [2]],
    ]);
    expect(changes[0].before).toEqual({ role: 'admin', feature_access: null });
    expect(changes[0].after).toEqual({ role: 'admin', feature_access: ['reports', 'debts'] });
  });

  it('keeps a creation followed by edits as a creation with the final values', () => {
    const [created] = mergeActivityRows([
      log('products', 'insert', null, product, { id: 1 }),
      log('products', 'update', product, { ...product, sale_price: 13000 }, { id: 2 }),
    ]);
    expect(created).toMatchObject({ action: 'insert', before: null, after: { sale_price: 13000 } });
  });

  it('keeps edits by different people, and a deletion after an edit, apart', () => {
    const changes = mergeActivityRows([
      log('products', 'update', product, { ...product, name: 'A' }, { id: 1, by: OWNER }),
      log('products', 'update', { ...product, name: 'A' }, { ...product, name: 'B' }, { id: 2, by: ADMIN }),
      log('promotions', 'update', { id: 'p1', name: 'X' }, { id: 'p1', name: 'Y' }, { id: 3 }),
      log('promotions', 'delete', { id: 'p1', name: 'Y' }, null, { id: 4 }),
    ]);
    expect(changes.map((item) => item.rows.map((row) => row.id))).toEqual([[1], [2], [3], [4]]);
  });

  it('joins the methods of one removed collection, and sorts by log id', () => {
    const changes = mergeActivityRows([
      log('money_collections', 'delete', { id: 'm2', request_id: 'req-1', payment_method: 'card', amount: 200 }, null, { id: 6 }),
      log('money_collections', 'delete', { id: 'm1', request_id: 'req-1', payment_method: 'cash', amount: 100 }, null, { id: 5 }),
      log('money_collections', 'delete', { id: 'm3', request_id: 'req-2', payment_method: 'cash', amount: 300 }, null, { id: 7 }),
    ]);
    expect(changes.map((item) => item.rows.map((row) => row.id))).toEqual([[5, 6], [7]]);
  });
});

describe('activityAuthor', () => {
  it('names the person, a removed person, or the system', () => {
    expect(activityAuthor(OWNER, lookups.people)).toBe('Jasur');
    expect(activityAuthor('user-gone', lookups.people)).toBe('Пользователь');
    expect(activityAuthor(null, lookups.people)).toBe('Система');
  });
});

describe('products', () => {
  it('announces a new product with prices that keep their fractions', () => {
    expect(text(log('products', 'insert', null, product))).toEqual([
      '🆕 Новый товар бара: Cola\nНапитки · продажа 12 000 сум · себестоимость 8 000,5 сум\nJasur',
    ]);
  });

  it('lists each changed field as old → new', () => {
    const notice = one(log('products', 'update', product, {
      ...product, name: 'Coca-Cola', sale_price: 13000, low_stock_threshold: 5, is_active: false,
    }, { by: ADMIN }));
    expect(notice).toMatchObject({ chat: 'club' });
    expect(notice.text).toBe([
      '✏️ Изменён товар бара: Coca-Cola',
      'Название: Cola → Coca-Cola',
      'Цена продажи: 12 000 сум → 13 000 сум',
      'Порог остатка: — → 5 шт.',
      'Продаётся: да → нет',
      'Aziz',
    ].join('\n'));
  });

  it('says a product was archived, even though archiving zeroes its stock', () => {
    expect(text(log('products', 'update', product, { ...product, is_deleted: true, is_active: false, current_stock: 0 }))).toEqual([
      '🗄 Товар убран в архив: Cola\nJasur',
    ]);
  });

  it('stays silent when a purchase removal moved stock and cost, or nothing visible changed', () => {
    expect(text(log('products', 'update', product, { ...product, cost_price: 7000, current_stock: 4 }))).toEqual([]);
    expect(text(log('products', 'update', product, { ...product, sort_order: 9 }))).toEqual([]);
    expect(text(log('products', 'delete', product, null))).toEqual([]);
  });

  it('keeps a person\u2019s edits when stock moved between them, telling only what they changed', () => {
    const counted = { ...product, current_stock: 6 };
    const notices = buildActivityNotices([
      log('products', 'update', product, { ...product, sale_price: 13000 }, { id: 1 }),
      // A purchase removed between the edits, by the same person.
      log('products', 'update', { ...product, sale_price: 13000 }, { ...product, sale_price: 13000, cost_price: 7500, current_stock: 6 }, { id: 2 }),
      // The closing save moved stock without a log row; the next edit starts from it.
      log('products', 'update', { ...counted, sale_price: 13000, cost_price: 7500 }, { ...counted, sale_price: 13000, cost_price: 7500, name: 'Coca-Cola' }, { id: 3 }),
    ], lookups);
    expect(notices).toHaveLength(1);
    expect(notices[0].text).toBe([
      '✏️ Изменён товар бара: Coca-Cola',
      'Название: Cola → Coca-Cola',
      'Цена продажи: 12 000 сум → 13 000 сум',
      'Jasur',
    ].join('\n'));
    expect(notices[0].logIds).toEqual([1, 3]);
  });
});

describe('closing stock', () => {
  const count = {
    id: 'count-1', product_id: 'prod-1', date: '2026-11-23', closing_stock: 10, added_today: 0,
    adjustment_quantity: 0, adjustment_reason: null,
  };

  it('announces a changed saved count', () => {
    expect(text(log('daily_stock_counts', 'update', count, { ...count, closing_stock: 8 }))).toEqual([
      '✏️ Изменён остаток бара: Cola\nсохранённый подсчёт · 23 ноября\nОстаток: 10 шт. → 8 шт.\nJasur',
    ]);
  });

  it('announces a correction set, changed or removed, with its note', () => {
    const corrected = { ...count, closing_stock: 12, adjustment_quantity: 2, adjustment_reason: 'correction: found a box' };
    expect(text(log('daily_stock_counts', 'update', count, corrected))).toEqual([[
      '✏️ Изменён остаток бара: Cola',
      'сохранённый подсчёт · 23 ноября',
      'Остаток: 10 шт. → 12 шт.',
      'Корректировка: — → +2 шт. (больше ожидаемого)',
      'Jasur: found a box',
    ].join('\n')]);
    expect(text(log('daily_stock_counts', 'update', corrected, count))[0]).toContain('Корректировка: +2 шт. (больше ожидаемого) → —');
  });

  it('leaves a write-off alone to /api/stock-write-offs, and a purchase to its own notice', () => {
    const writtenOff = { ...count, closing_stock: 9, adjustment_quantity: -1, adjustment_reason: 'shortage' };
    expect(text(log('daily_stock_counts', 'update', count, writtenOff))).toEqual([]);
    expect(text(log('daily_stock_counts', 'update', count, { ...writtenOff, closing_stock: 10 }))).toEqual([]);
    expect(text(log('daily_stock_counts', 'update', count, { ...count, closing_stock: 15, added_today: 5 }))).toEqual([]);
    expect(text(log('daily_stock_counts', 'update', count, { ...count }))).toEqual([]);
  });

  it('does not take the evening\u2019s first count over a write-off placeholder for a change', () => {
    // A write-off saved on the open day before the count leaves nothing sold yet.
    const placeholder = { ...count, date: '2026-11-24', closing_stock: 9, sold_quantity: 0, adjustment_quantity: -1, adjustment_reason: 'shortage' };
    expect(text(log('daily_stock_counts', 'update', placeholder, { ...placeholder, closing_stock: 4, sold_quantity: 5 }))).toEqual([]);
    // A correction changed with that first count is still news, without the count itself.
    const correctionPlaceholder = { ...placeholder, closing_stock: 11, adjustment_quantity: 1, adjustment_reason: 'correction' };
    expect(text(log('daily_stock_counts', 'update', correctionPlaceholder, { ...correctionPlaceholder, closing_stock: 7, sold_quantity: 5, adjustment_quantity: 2 }))).toEqual([
      '✏️ Изменён остаток бара: Cola\n24 ноября\nКорректировка: +1 шт. (больше ожидаемого) → +2 шт. (больше ожидаемого)\nJasur',
    ]);
    // A count of an earlier day, or one where something was already sold, is a genuine re-count.
    expect(text(log('daily_stock_counts', 'update', { ...placeholder, date: '2026-11-23' }, { ...placeholder, date: '2026-11-23', closing_stock: 4 }))[0])
      .toContain('Остаток: 9 шт. → 4 шт.');
    expect(text(log('daily_stock_counts', 'update', { ...placeholder, sold_quantity: 3 }, { ...placeholder, sold_quantity: 8, closing_stock: 4 }))[0])
      .toContain('Остаток: 9 шт. → 4 шт.');
  });

  it('still announces a recount saved together with a write-off', () => {
    const [message] = text(log('daily_stock_counts', 'update', count, {
      ...count, closing_stock: 6, adjustment_quantity: -1, adjustment_reason: 'expired: old',
    }));
    expect(message).toContain('Остаток: 10 шт. → 6 шт.');
    expect(message).toContain('Корректировка: — → −1 шт. (просрочка)');
  });
});

describe('promotions', () => {
  const promotion = {
    id: 'promo-1', name: 'Cola for 100k', product_id: 'prod-1', free_quantity: 1, min_spend: 100000,
    starts_on: '2026-11-01', ends_on: null, is_active: true,
  };

  it('announces a creation and a deletion with the rule', () => {
    expect(text(log('promotions', 'insert', null, promotion))).toEqual([
      '🎁 Новая акция: Cola for 100k\n1 шт. Cola бесплатно · при чеке от 100 000 сум · с 1 ноября\nJasur',
    ]);
    expect(text(log('promotions', 'delete', { ...promotion, ends_on: '2026-11-30' }, null))).toEqual([
      '🗑 Удалена акция: Cola for 100k\n1 шт. Cola бесплатно · при чеке от 100 000 сум · 1 ноября – 30 ноября\nУдалил(а) Jasur',
    ]);
  });

  it('announces switching a promotion off or on in one line', () => {
    expect(text(log('promotions', 'update', promotion, { ...promotion, is_active: false }))[0]).toMatch(/^⏸ Акция выключена: Cola for 100k/);
    expect(text(log('promotions', 'update', { ...promotion, is_active: false }, promotion))[0]).toMatch(/^▶️ Акция включена: Cola for 100k/);
  });

  it('lists changed fields of an edit', () => {
    const [message] = text(log('promotions', 'update', promotion, {
      ...promotion, product_id: 'prod-2', min_spend: 150000, ends_on: '2026-12-31', is_active: false,
    }));
    expect(message).toBe([
      '✏️ Изменена акция: Cola for 100k',
      'Товар: Cola → Pepsi',
      'Чек от: 100 000 сум → 150 000 сум',
      'Окончание: — → 31 декабря',
      'Действует: да → нет',
      'Jasur',
    ].join('\n'));
    expect(text(log('promotions', 'update', promotion, { ...promotion }))).toEqual([]);
  });
});

describe('team access', () => {
  it('announces access granted with the sections it opens', () => {
    expect(text(log('club_memberships', 'insert', null, {
      club_id: 'club-1', user_id: 'user-new', role: 'viewer', feature_access: ['reports', 'debts'],
    }, { rowId: 'user-new' }))).toEqual([
      '👤 Выдан доступ: Dilnoza\nРоль: Наблюдатель\nРазделы: Отчёты, Долги\nJasur',
    ]);
    expect(text(log('club_memberships', 'insert', null, { user_id: 'user-new', role: 'owner' }, { rowId: 'user-new' }))).toEqual([
      '👤 Выдан доступ: Dilnoza\nРоль: Владелец\nJasur',
    ]);
  });

  it('announces a role change and page access opened and closed, merged into one message', () => {
    const notices = buildActivityNotices([
      log('club_memberships', 'update', { user_id: 'user-new', role: 'viewer', feature_access: ['reports', 'debts'] },
        { user_id: 'user-new', role: 'viewer', feature_access: ['reports'] }, { rowId: 'user-new' }),
      log('club_memberships', 'update', { user_id: 'user-new', role: 'viewer', feature_access: ['reports'] },
        { user_id: 'user-new', role: 'admin', feature_access: ['reports', 'daily_cash'] }, { rowId: 'user-new' }),
    ], lookups);
    expect(notices).toHaveLength(1);
    expect(notices[0].text).toBe([
      '🔑 Изменён доступ: Dilnoza',
      'Роль: Наблюдатель → Администратор',
      'Открыто: Дневная касса',
      'Закрыто: Долги',
      'Jasur',
    ].join('\n'));
    expect(notices[0].logIds).toHaveLength(2);
  });

  it('announces access removed, and stays silent when nothing effective changed', () => {
    expect(text(log('club_memberships', 'delete', { user_id: 'user-gone', role: 'admin' }, null, { rowId: 'user-gone' }))).toEqual([
      '🚫 Доступ закрыт: Пользователь\nРоль была: Администратор\nЗакрыл(а) Jasur',
    ]);
    // An owner reaches every section whatever the stored list says.
    expect(text(log('club_memberships', 'update', { user_id: OWNER, role: 'owner', feature_access: null },
      { user_id: OWNER, role: 'owner', feature_access: ['reports'] }, { rowId: OWNER }))).toEqual([]);
  });
});

describe('club settings', () => {
  const club = {
    id: 'club-1', name: 'Pixel', address: null, business_day_start_hour: 0,
    enabled_payment_methods: ['cash', 'terminal'], internet_payment_day: null,
  };

  it('lists the changed settings', () => {
    expect(text(log('clubs', 'update', club, {
      ...club, address: 'Matbuotchilar 17', business_day_start_hour: 6, enabled_payment_methods: ['cash', 'terminal', 'card'], internet_payment_day: 5,
    }))).toEqual([[
      '⚙️ Изменены настройки клуба',
      'Адрес: — → Matbuotchilar 17',
      'Начало рабочего дня: 0:00 → 6:00',
      'Способы оплаты: Наличные, Терминал → Наличные, Терминал, Карта',
      'День оплаты интернета: — → 5-е число',
      'Jasur',
    ].join('\n')]);
    expect(text(log('clubs', 'update', club, { ...club, name: 'Pixel Gaming', enabled_payment_methods: null }))[0])
      .toContain('Способы оплаты: Наличные, Терминал → все');
    expect(text(log('clubs', 'update', club, { ...club }))).toEqual([]);
  });
});

describe('planned expenses', () => {
  const preset = {
    id: 'pre-1', name: 'Rent', category: 'rent', payment_source: 'game_club', payment_method: null, monthly_amount: 5_000_000, archived_at: null,
  };

  it('announces a new, changed, archived and restored planned expense', () => {
    expect(text(log('expense_presets', 'insert', null, preset))).toEqual([
      '🗓 Новый плановый расход: Rent\nИгровой клуб · Аренда · 5 000 000 сум в месяц\nJasur',
    ]);
    expect(text(log('expense_presets', 'update', preset, { ...preset, payment_method: 'card', monthly_amount: 6_000_000 }))).toEqual([[
      '✏️ Изменён плановый расход: Rent',
      'Оплата: любая → Карта',
      'Сумма: 5 000 000 сум в месяц → 6 000 000 сум в месяц',
      'Jasur',
    ].join('\n')]);
    const archived = { ...preset, archived_at: '2026-11-24T10:00:00Z' };
    expect(text(log('expense_presets', 'update', preset, archived))).toEqual(['🗄 Плановый расход в архиве: Rent\nJasur']);
    expect(text(log('expense_presets', 'update', archived, preset))).toEqual(['↩️ Плановый расход возвращён из архива: Rent\nJasur']);
    expect(text(log('expense_presets', 'update', preset, { ...preset }))).toEqual([]);
  });
});

describe('salaries', () => {
  it('leaves employee details to /api/salaries', () => {
    expect(text(log('salary_employees', 'update', { id: 'emp-1', name: 'Izzat', job_title: '' }, { id: 'emp-1', name: 'Izzatbek', job_title: 'Admin' }))).toEqual([]);
  });

  it('leaves a corrected payment method to the expense change notice', () => {
    expect(text(log('salary_entries', 'update', { id: 's1', payment_method: 'cash' }, { id: 's1', payment_method: 'card' }))).toEqual([]);
  });

  it('tells the owners’ group about a shortage recovered later, not one saved with its shortage', () => {
    const fine = { id: 'fine-1', employee_id: 'emp-1', amount: 20_000, kind: 'fine', cash_shortage_id: 'short-1', created_at: '2026-11-22T08:00:00+00:00' };
    expect(one(log('salary_entries', 'insert', null, fine))).toEqual({
      chat: 'owners',
      text: '↩️ Недостача: удержано из зарплаты 20 000 сум\nIzzat · недостача 50 000 сум от 20 ноября\nJasur',
      logIds: [expect.any(Number)],
    });
    expect(text(log('salary_entries', 'insert', null, { ...fine, created_at: '2026-11-20T10:00:00+00:00' }))).toEqual([]);
    expect(text(log('salary_entries', 'insert', null, { ...fine, cash_shortage_id: 'short-unknown' }))).toEqual([]);
  });
});

describe('owner money', () => {
  const withdrawal = {
    id: 'w1', period_month: '2026-11-01', source: 'game_club', payment_method: 'cash', amount: 3_000_000, comment: 'для ремонта дома',
  };

  it('announces a withdrawal, its edit and its deletion', () => {
    expect(text(log('owner_withdrawals', 'insert', null, withdrawal))).toEqual([
      '💰 Владелец забрал прибыль: 3 000 000 сум\nИгровой клуб · Наличные · за ноябрь 2026\nJasur: для ремонта дома',
    ]);
    expect(text(log('owner_withdrawals', 'update', withdrawal, { ...withdrawal, amount: 2_500_000 }))).toEqual([[
      '✏️ Изменено снятие прибыли: 2 500 000 сум',
      'Игровой клуб · Наличные · за ноябрь 2026',
      'Сумма: 3 000 000 сум → 2 500 000 сум',
      'Изменил(а) Jasur',
    ].join('\n')]);
    expect(text(log('owner_withdrawals', 'delete', withdrawal, null, { by: ADMIN }))).toEqual([
      '🗑 Удалено снятие прибыли: 3 000 000 сум\nИгровой клуб · Наличные · за ноябрь 2026\n💬 для ремонта дома\nУдалил(а) Aziz',
    ]);
    expect(text(log('owner_withdrawals', 'update', withdrawal, { ...withdrawal }))).toEqual([]);
  });

  it('tells one "withdraw all" of several methods and the bar as one message', () => {
    const at = '2026-11-24T10:00:00.123456+00:00';
    const part = (id: string, source: string, paymentMethod: string | null, amount: number) => log('owner_withdrawals', 'insert', null, {
      id, period_month: '2026-11-01', source, payment_method: paymentMethod, amount, comment: 'всё за ноябрь владельцу сегодня', created_at: at,
    });
    const notices = buildActivityNotices([
      part('w1', 'game_club', 'cash', 2_000_000),
      part('w2', 'game_club', 'terminal', 500_000),
      part('w3', 'bar', null, 300_000),
      // Another withdrawal saved later is its own message.
      log('owner_withdrawals', 'insert', null, { ...withdrawal, id: 'w4', created_at: '2026-11-24T11:00:00+00:00' }),
    ], lookups);
    expect(notices.map((notice) => notice.text)).toEqual([
      '💰 Владелец забрал прибыль: 2 800 000 сум\nНаличные 2 000 000 · Терминал 500 000 · Бар 300 000 · за ноябрь 2026\nJasur: всё за ноябрь владельцу сегодня',
      '💰 Владелец забрал прибыль: 3 000 000 сум\nИгровой клуб · Наличные · за ноябрь 2026\nJasur: для ремонта дома',
    ]);
    expect(notices[0].logIds).toHaveLength(3);
  });

  it('announces a profit carryover and its deletion', () => {
    const carry = { id: 'c1', from_month: '2026-10-01', to_month: '2026-11-01', source: 'bar', payment_method: null, amount: 400_000, comment: null };
    expect(text(log('owner_profit_carryovers', 'insert', null, carry))).toEqual([
      '➡️ Прибыль перенесена на следующий месяц: 400 000 сум\nБар · октябрь 2026 → ноябрь 2026\nJasur',
    ]);
    expect(text(log('owner_profit_carryovers', 'delete', carry, null))[0]).toMatch(/^🗑 Удалён перенос прибыли: 400 000 сум/);
    expect(text(log('owner_profit_carryovers', 'update', carry, { ...carry, amount: 300_000 }))[0]).toContain('Сумма: 400 000 сум → 300 000 сум');
  });
});

describe('purchases, debts, collected money', () => {
  const purchase = { id: 'pu1', product_id: 'prod-1', quantity: 24, cost_price: 8500.5, payment_method: 'cash', date: '2026-11-24', comment: null };

  it('announces a purchase, its correction and its deletion', () => {
    expect(text(log('stock_purchases', 'insert', null, purchase))).toEqual([
      '📦 Закупка бара: 204 012 сум\nCola · 24 шт. × 8 500,5 сум · Наличные · 24 ноября\nJasur',
    ]);
    expect(text(log('stock_purchases', 'insert', null, { ...purchase, sale_price: 14000 }))[0]).toBe(
      '📦 Закупка бара: 204 012 сум\nCola · 24 шт. × 8 500,5 сум · Наличные · 24 ноября\nНовая цена продажи: 14 000 сум\nJasur',
    );
    expect(text(log('stock_purchases', 'update', purchase, { ...purchase, quantity: 12 }))[0]).toContain('Количество: 24 шт. → 12 шт.');
    expect(text(log('stock_purchases', 'delete', purchase, null))[0]).toMatch(/^🗑 Удалена закупка бара: 204 012 сум\n.*\nУдалил\(а\) Jasur$/);
  });

  it('announces a new debt and a debt payment, nothing else of them', () => {
    expect(text(log('new_debts', 'insert', null, { amount: 150_000, person_name: 'Bekzod', category: null, date: '2026-11-24', comment: 'взял в долг до пятницы точно' }))).toEqual([
      '📝 Новый долг: 150 000 сум\nBekzod · 24 ноября\nJasur: взял в долг до пятницы точно',
    ]);
    expect(text(log('debt_payments', 'insert', null, { debt_id: 'debt-1', amount: 50_000, payment_method: 'card', date: '2026-11-24', comment: null }))).toEqual([
      '✅ Оплата долга: 50 000 сум\nBekzod · Карта · 24 ноября\nJasur',
    ]);
    expect(text(log('new_debts', 'delete', { amount: 1 }, null), log('debt_payments', 'update', { amount: 1 }, { amount: 2 }))).toEqual([]);
  });

  it('announces a removed collection as one message for all its methods', () => {
    expect(text(
      log('money_collections', 'delete', { id: 'm1', request_id: 'req-1', date: '2026-11-23', payment_method: 'cash', amount: 300_000, comment: null }, null),
      log('money_collections', 'delete', { id: 'm2', request_id: 'req-1', date: '2026-11-23', payment_method: 'terminal', amount: 200_000, comment: null }, null),
    )).toEqual([
      '↩️ Сбор денег отменён: 500 000 сум\nНаличные 300 000 · Терминал 200 000 · 23 ноября\nДеньги вернулись в кассу\nОтменил(а) Jasur',
    ]);
    expect(text(log('money_collections', 'update', { amount: 1 }, { amount: 2 }))).toEqual([]);
  });

  it('announces collected money moved into the reserve, not other reserve moves', () => {
    const move = { id: 'r1', kind: 'deposit', from_collected: true, payment_method: 'cash', amount: 100_000, entry_date: '2026-11-24', period_month: '2026-11-01', comment: null };
    expect(text(log('owner_reserve_entries', 'insert', null, move))).toEqual([
      '🏦 Собранные деньги в резерв: 100 000 сум\nНаличные · 24 ноября\nJasur',
    ]);
    expect(text(log('owner_reserve_entries', 'insert', null, { ...move, from_collected: false }))).toEqual([]);
  });
});

describe('cash shortages', () => {
  it('tells only the owners’ group about a deleted shortage', () => {
    const shortage = { id: 'short-1', date: '2026-11-20', payment_source: 'game_club', payment_method: 'cash', amount: 50_000, comment: 'не хватило денег при сдаче смены' };
    expect(one(log('cash_shortages', 'delete', shortage, null))).toMatchObject({
      chat: 'owners',
      text: '🗑 Удалена недостача: 50 000 сум\nИгровой клуб · Наличные · 20 ноября\n💬 не хватило денег при сдаче смены\nУдалил(а) Jasur',
    });
    expect(text(log('cash_shortages', 'update', shortage, { ...shortage, amount: 1 }))).toEqual([]);
  });
});

describe('buildActivityNotice', () => {
  it('ignores a table it has no message for', () => {
    expect(buildActivityNotice({ table: 'expenses', action: 'update', before: {}, after: {}, changedBy: null, rows: [] }, lookups)).toBeNull();
  });

  it('names the system for a change no user made', () => {
    expect(text(log('new_debts', 'insert', null, { amount: 1000, person_name: 'X', date: '2026-11-24' }, { by: null }))[0]).toMatch(/\nСистема$/);
  });
});
