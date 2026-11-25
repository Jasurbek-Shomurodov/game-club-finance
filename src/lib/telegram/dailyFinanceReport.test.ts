import { describe, expect, it } from 'vitest';
import {
  buildDailyFinanceReportInput,
  buildDailyGameClubIncomeSeries,
  buildDailyPlaystationIncomeSeries,
  calculateOutstandingDebtsAsOf,
  formatRussianDailyFinanceReportCaption,
  formatRussianDailyFinanceReport,
  formatRussianStockAdjustmentsCaption,
  hasStockAdjustments,
  internetPaymentDueDate,
  monthStartIso,
  previousComparableMonthRangeIso,
  REPORT_MONEY_CHECK_MAX,
  reportDayMoneyChecks,
  reportMoneyCheckText,
  runningDailyAverage,
  selectDayPaymentMethods,
  summarizeMonthMoney,
  summarizeStockCorrectionsForReport,
  summarizeStockWriteOffsForReport,
} from './dailyFinanceReport';
import type { MoneyCheck } from '../calculations/moneyChecks';
import { isIsoDate, nextDailyReportBusinessDateIso, previousClubBusinessDateIso } from './sendDailyFinanceReport';

describe('formatRussianDailyFinanceReport', () => {
  it('leaves the title, the date and the club name to the image: an empty caption without anything to flag', () => {
    expect(formatRussianDailyFinanceReportCaption({
      clubName: 'Main Game Club',
      businessDateLabel: '27 августа 2026',
      gameClubIncome: 0,
      computerIncome: 0,
      debtIncome: 0,
      playstationIncome: 0,
      barSales: 0,
      barCost: 0,
      gameClubProfit: 0,
      barProfit: 0,
      stockPurchases: 0,
      gameClubExpenses: 0,
      barExpenses: 0,
      gameClubExpenseCategories: [],
      barExpenseCategories: [],
      monthToDateRevenue: 0,
      gameClubMoneyLeft: 0,
      averageDailyGameClubIncome: 0,
      barMoneyLeft: 0,
      inventoryValue: 0,
      activeDebts: 0,
    })).toBe('');
  });

  it('formats the saved Russian Telegram daily finance template', () => {
    const message = formatRussianDailyFinanceReport({
        clubName: 'Pixel Game Zone',
        businessDateLabel: '4 июля 2026',
        gameClubIncome: 0,
        computerIncome: 0,
        debtIncome: 0,
        playstationIncome: 0,
        barSales: 931_000,
        barCost: 400_000,
        gameClubProfit: 0,
        barProfit: 531_000,
        stockPurchases: 668_000,
        gameClubExpenses: 0,
        barExpenses: 0,
        gameClubExpenseCategories: [],
        barExpenseCategories: [],
        monthToDateRevenue: 4_000_000,
        gameClubMoneyLeft: 3_024_000,
        averageDailyGameClubIncome: 756_000,
        barMoneyLeft: 2_311_000,
        inventoryValue: 8_473_309,
        activeDebts: 0,
      });

    expect(message).toContain('🍫 Продажи бара: 931 000 UZS\n');
    expect(message).toContain('🎮 Прибыль клуба: 0 UZS');
    expect(message).toContain('🍫 Прибыль бара: 531 000 UZS');
    // Club and bar money are separate businesses: nothing adds them together.
    expect(message).not.toContain('Выручка за день');
    expect(message).not.toContain('Валовая прибыль');
    expect(message).not.toContain('Чистая прибыль');
    expect(message).not.toContain('клуб + бар');
    expect(message).toContain('🗓 Доход клуба с начала месяца: 4 000 000 UZS');
    expect(message).toContain('📈 Средний дневной доход клуба за месяц: 756 000 UZS');
    expect(message).not.toContain('Средний доход клуба в день');
  });

  it('uses daily rows for the report day and month-to-date rows for balances', () => {
    const input = buildDailyFinanceReportInput({
      clubName: 'Pixel Game Club',
      businessDate: '2026-07-04',
      businessDateLabel: '4 июля 2026',
      cashRows: [
        {
          date: '2026-07-04',
          cash_income: 500_000,
          terminal_income: 120_000,
          card_income: 80_000,
          playstation_income: 50_000,
        },
      ],
      stockRows: [
        {
          date: '2026-07-04',
          bar_income: 300_000,
          bar_profit: 100_000,
          bar_cost: 200_000,
          sold_quantity: 10,
        },
      ],
      stockPurchaseRows: [{ date: '2026-07-04', quantity: 2, cost_price: 50_000 }],
      expenseRows: [
        {
          id: 'game-club-expense',
          date: '2026-07-04',
          amount: 80_000,
          category: 'salary',
          payment_source: 'game_club',
          comment: null,
          created_at: '2026-07-04T10:00:00Z',
        },
        {
          id: 'custom-game-club-expense',
          date: '2026-07-04',
          amount: 40_000,
          category: 'other',
          payment_source: 'game_club',
          comment: 'Elektrenergiya',
          created_at: '2026-07-04T10:30:00Z',
        },
        {
          id: 'bar-expense',
          date: '2026-07-04',
          amount: 40_000,
          category: 'repair',
          payment_source: 'bar',
          comment: null,
          created_at: '2026-07-04T11:00:00Z',
        },
      ],
      monthCashRows: [
        {
          date: '2026-07-01',
          cash_income: 1_000_000,
          terminal_income: 100_000,
          card_income: 0,
          playstation_income: 0,
        },
        {
          date: '2026-07-04',
          cash_income: 500_000,
          terminal_income: 120_000,
          card_income: 80_000,
          playstation_income: 50_000,
        },
      ],
      monthStockRows: [
        {
          date: '2026-07-01',
          bar_income: 400_000,
          bar_profit: 150_000,
          bar_cost: 250_000,
          sold_quantity: 14,
        },
        {
          date: '2026-07-04',
          bar_income: 300_000,
          bar_profit: 100_000,
          bar_cost: 200_000,
          sold_quantity: 10,
        },
      ],
      monthStockPurchaseRows: [
        { date: '2026-07-01', quantity: 5, cost_price: 20_000 },
        { date: '2026-07-04', quantity: 2, cost_price: 50_000 },
      ],
      monthExpenseRows: [
        {
          id: 'month-game-club-expense',
          date: '2026-07-01',
          amount: 100_000,
          category: 'salary',
          payment_source: 'game_club',
          comment: null,
          created_at: '2026-07-01T10:00:00Z',
        },
        {
          id: 'month-bar-expense',
          date: '2026-07-04',
          amount: 40_000,
          category: 'repair',
          payment_source: 'bar',
          comment: null,
          created_at: '2026-07-04T11:00:00Z',
        },
      ],
      debtRows: [
        { date: '2026-07-04', amount: 90_000, remaining_amount: 90_000, status: 'unpaid' },
        { remaining_amount: 20_000, status: 'paid' },
      ],
      productRows: [
        { current_stock: 3, cost_price: 12_000 },
        { current_stock: 2, cost_price: 7_000 },
      ],
    });

    expect(input).toMatchObject({
      gameClubIncome: 840_000,
      computerIncome: 790_000,
      debtIncome: 90_000,
      playstationIncome: 50_000,
      barSales: 300_000,
      barCost: 200_000,
      gameClubProfit: 720_000,
      barProfit: 60_000,
      stockPurchases: 100_000,
      gameClubExpenses: 120_000,
      barExpenses: 40_000,
      gameClubExpenseCategories: [
        { name: 'Зарплата', amount: 80_000 },
        { name: 'Elektrenergiya', amount: 40_000 },
      ],
      barExpenseCategories: [{ name: 'Ремонт', amount: 40_000 }],
      monthToDateRevenue: 1_940_000,
      gameClubMoneyLeft: 1_750_000,
      averageDailyGameClubIncome: 485_000,
      barMoneyLeft: 560_000,
      inventoryValue: 50_000,
      activeDebts: 90_000,
    });
  });

  it('formats each business with its own expenses and profit, never a combined total', () => {
    const message = formatRussianDailyFinanceReport({
        clubName: 'Main Game Club',
        businessDateLabel: '3 июля 2026',
        gameClubIncome: 1_904_000,
        computerIncome: 1_904_000,
        debtIncome: 0,
        playstationIncome: 0,
        barSales: 592_000,
        barCost: 250_000,
        gameClubProfit: 1_340_000,
        barProfit: 282_000,
        stockPurchases: 0,
        gameClubExpenses: 564_000,
        barExpenses: 60_000,
        gameClubExpenseCategories: [
          { name: 'Зарплата', amount: 340_000 },
          { name: 'Пополнение Номера', amount: 224_000 },
        ],
        barExpenseCategories: [{ name: 'Еда / Напитки', amount: 60_000 }],
        monthToDateRevenue: 5_000_000,
        gameClubMoneyLeft: 2_941_000,
        averageDailyGameClubIncome: 980_333,
        barMoneyLeft: 1_084_000,
        inventoryValue: 8_473_309,
        activeDebts: 0,
      });

    expect(message).toContain(`🎮 Доход клуба: 1 904 000 UZS
  • Компьютеры: 1 904 000 UZS (100%)
  • Долги: 0 UZS (0%)
  • PlayStation: 0 UZS (0%)
💸 Расходы из денег клуба: 564 000 UZS
  - Зарплата: 340 000 UZS
  - Пополнение Номера: 224 000 UZS
🎮 Прибыль клуба: 1 340 000 UZS`);
    expect(message).toContain(`🍫 Продажи бара: 592 000 UZS
📉 Себестоимость бара: 250 000 UZS
💸 Расходы из денег бара: 60 000 UZS
  - Еда / Напитки: 60 000 UZS
🍫 Прибыль бара: 282 000 UZS`);
    expect(message).not.toContain('624 000');
    expect(message).not.toContain('Выручка за день');
    expect(message).not.toContain('KPI и бонусы');
  });

  it('uses the saved description for other expenses and falls back when it is blank', () => {
    const input = buildDailyFinanceReportInput({
      clubName: 'Pixel Game Club',
      businessDate: '2026-08-25',
      businessDateLabel: '25 августа 2026',
      cashRows: [],
      stockRows: [],
      stockPurchaseRows: [],
      expenseRows: [
        {
          id: 'described-other',
          date: '2026-08-25',
          amount: 3_541_000,
          category: 'other',
          payment_source: 'game_club',
          comment: '  Elektrenergiya  ',
          created_at: '2026-08-25T17:56:47Z',
        },
        {
          id: 'blank-other',
          date: '2026-08-25',
          amount: 25_000,
          category: 'other',
          payment_source: 'game_club',
          comment: '   ',
          created_at: '2026-08-25T18:00:00Z',
        },
      ],
      debtRows: [],
    });

    expect(input.gameClubExpenseCategories).toEqual([
      { name: 'Elektrenergiya', amount: 3_541_000 },
      { name: 'Другое', amount: 25_000 },
    ]);
  });

  it('keeps club month revenue separate and compares monthly metrics with the prior month', () => {
    const currentCash = {
      date: '2026-08-28',
      cash_income: 2_000_000,
      terminal_income: 0,
      card_income: 0,
      playstation_income: 0,
    };
    const currentStock = {
      date: '2026-08-28',
      bar_income: 1_000_000,
      bar_profit: 600_000,
      bar_cost: 400_000,
      sold_quantity: 10,
    };
    const currentBarExpense = {
      id: 'current-bar-expense',
      date: '2026-08-28',
      amount: 100_000,
      category: 'other',
      payment_source: 'bar' as const,
      comment: null,
      created_at: '2026-08-28T10:00:00Z',
    };
    const previousBarExpense = {
      ...currentBarExpense,
      id: 'previous-bar-expense',
      date: '2026-07-28',
      created_at: '2026-07-28T10:00:00Z',
    };

    const input = buildDailyFinanceReportInput({
      clubName: 'Main Game Club',
      businessDate: '2026-08-28',
      businessDateLabel: '28 августа 2026',
      cashRows: [currentCash],
      stockRows: [currentStock],
      stockPurchaseRows: [{ date: '2026-08-28', quantity: 1, cost_price: 100_000 }],
      expenseRows: [currentBarExpense],
      monthCashRows: [currentCash],
      monthStockRows: [currentStock],
      monthStockPurchaseRows: [{ date: '2026-08-28', quantity: 1, cost_price: 100_000 }],
      monthExpenseRows: [currentBarExpense],
      previousMonthCashRows: [{ ...currentCash, date: '2026-07-28', cash_income: 1_000_000 }],
      previousMonthStockRows: [{ ...currentStock, date: '2026-07-28', bar_income: 500_000 }],
      previousMonthStockPurchaseRows: [{ date: '2026-07-28', quantity: 1, cost_price: 100_000 }],
      previousMonthExpenseRows: [previousBarExpense],
      previousMonthInventoryRows: [{
        product_id: 'product-1',
        date: '2026-07-28',
        closing_stock: 1,
        cost_price: 100_000,
        products: { tracks_inventory: true },
      }],
      productRows: [{ current_stock: 2, cost_price: 100_000, tracks_inventory: true }],
      debtRows: [],
    });

    expect(input.monthToDateRevenue).toBe(2_000_000);
    expect(input.monthToDateRevenue).not.toBe(3_000_000);
    expect(input.averageDailyGameClubIncomeChange).toBe(100);
    expect(input.barMoneyLeftChange).toBe(167);
    expect(input.inventoryValueChange).toBe(100);
    expect(input.monthBarSales).toBe(1_000_000);
    expect(input).not.toHaveProperty('monthTotalIncome');
    expect(input).not.toHaveProperty('monthSankey');
    expect(input.monthGameClubProfit).toBe(2_000_000);
    expect(input.monthBarProfit).toBe(500_000);
    const nodes = (list: { key: string; amount: number }[] | undefined) =>
      list?.map(({ key, amount }) => ({ key, amount }));
    // Club money and bar money flow in separate Sankeys; neither carries the other's income.
    expect(nodes(input.monthGameClubSankey?.sources)).toEqual([{ key: 'computers', amount: 2_000_000 }]);
    expect(nodes(input.monthGameClubSankey?.targets)).toEqual([{ key: '__game_club_left', amount: 2_000_000 }]);
    expect(input.monthGameClubSankey?.income).toBe(2_000_000);
    expect(nodes(input.monthBarSankey?.sources)).toEqual([{ key: 'bar', amount: 1_000_000 }]);
    expect(nodes(input.monthBarSankey?.targets)).toEqual([
      { key: '__bar_cost', amount: 400_000 },
      { key: 'other', amount: 100_000 },
      { key: '__bar_left', amount: 500_000 },
    ]);
    expect(input.monthBarSankey?.income).toBe(1_000_000);
    expect(input.monthDailyGameClubIncome).toHaveLength(28);
    expect(input.monthDailyGameClubIncome?.[0]).toEqual({ date: '2026-08-01', amount: 0 });
    expect(input.monthDailyGameClubIncome?.[27]).toEqual({ date: '2026-08-28', amount: 2_000_000 });
  });

  it('adds recorded debts to the day they were given in the month income series', () => {
    const series = buildDailyGameClubIncomeSeries(
      [
        { date: '2026-08-01', cash_income: 100, terminal_income: 50, card_income: 25, playstation_income: 10 },
        { date: '2026-08-02', cash_income: 200, terminal_income: 0, card_income: 0 },
      ],
      [{ date: '2026-08-02', amount: 40, remaining_amount: 40, status: 'active' }],
      { from: '2026-08-01', to: '2026-08-03' },
    );

    expect(series).toEqual([
      { date: '2026-08-01', amount: 185 },
      { date: '2026-08-02', amount: 240 },
      { date: '2026-08-03', amount: 0 },
    ]);
  });

  it('lists low-stock products in the text report and counts them in the caption', () => {
    const baseRows = {
      clubName: 'Main Game Club',
      businessDate: '2026-09-29',
      businessDateLabel: '29 сентября 2026',
      cashRows: [],
      stockRows: [],
      stockPurchaseRows: [],
      expenseRows: [],
      debtRows: [],
    };
    const product = { tracks_inventory: true, is_active: true, is_deleted: false };
    const input = buildDailyFinanceReportInput({
      ...baseRows,
      lowStockProductRows: [
        { ...product, name: 'Cola', current_stock: 3, low_stock_threshold: null },
        { ...product, name: 'Red Bull', current_stock: 0, low_stock_threshold: 6 },
        { ...product, name: 'Water', current_stock: 40, low_stock_threshold: 10 },
      ],
    });

    expect(formatRussianDailyFinanceReport(input).split('\n').slice(-3)).toEqual([
      '⚠️ Заканчивается на складе (2):',
      '  • Red Bull: нет в наличии',
      '  • Cola: 3 шт. (порог 5)',
    ]);
    // The image lists them; the caption does not count them.
    expect(formatRussianDailyFinanceReportCaption(input)).not.toContain('Заканчивается');

    const healthy = buildDailyFinanceReportInput(baseRows);
    expect(healthy.lowStockProducts).toBeUndefined();
    expect(formatRussianDailyFinanceReport(healthy)).not.toContain('Заканчивается');
    expect(formatRussianDailyFinanceReportCaption(healthy)).not.toContain('Заканчивается');
  });
});

describe('previousClubBusinessDateIso', () => {
  it('uses the day before the club\'s current Tashkent business date', () => {
    // 01:00 UTC is 06:00 in Tashkent.
    expect(previousClubBusinessDateIso(new Date('2026-07-05T01:00:00.000Z'), 0)).toBe('2026-07-04');
    expect(previousClubBusinessDateIso(new Date('2026-07-01T01:00:00.000Z'), 0)).toBe('2026-06-30');
  });

  it('never reports a business day that is still open', () => {
    // 06:00 in Tashkent: a club opening at 08:00 is still in its 4 July day.
    expect(previousClubBusinessDateIso(new Date('2026-07-05T01:00:00.000Z'), 8)).toBe('2026-07-03');
    // 08:00 in Tashkent: the 4 July day has just closed.
    expect(previousClubBusinessDateIso(new Date('2026-07-05T03:00:00.000Z'), 8)).toBe('2026-07-04');
  });
});

describe('isIsoDate', () => {
  it('accepts only real calendar dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-1-01')).toBe(false);
  });
});

describe('monthStartIso', () => {
  it('returns the first date of the same month', () => {
    expect(monthStartIso('2026-07-04')).toBe('2026-07-01');
  });

  it('builds a previous comparable month-to-date range', () => {
    expect(previousComparableMonthRangeIso('2026-08-28')).toEqual({
      from: '2026-07-01',
      to: '2026-07-28',
    });
    expect(previousComparableMonthRangeIso('2026-03-31')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });
});


it('keeps dated report inventory unchanged after product archival and ignores future closings', () => {
  const rows = {
    clubName: 'Test', businessDate: '2026-09-02', businessDateLabel: '2 September',
    cashRows: [], stockRows: [], stockPurchaseRows: [], expenseRows: [], debtRows: [],
    inventoryRows: [
      { product_id: 'tracked', date: '2026-09-01', closing_stock: 10, cost_price: 8, products: { tracks_inventory: true } },
      { product_id: 'tracked', date: '2026-09-02', closing_stock: 7, cost_price: 6, products: { tracks_inventory: true } },
      { product_id: 'tracked', date: '2026-09-03', closing_stock: 99, cost_price: 99, products: { tracks_inventory: true } },
      { product_id: 'made-to-order', date: '2026-09-02', closing_stock: 10, cost_price: 10, products: { tracks_inventory: false } },
    ],
  };
  const before = buildDailyFinanceReportInput({ ...rows, productRows: [{ current_stock: 7, cost_price: 6 }] });
  const after = buildDailyFinanceReportInput({ ...rows, productRows: [] });
  expect(before.inventoryValue).toBe(42);
  expect(after).toEqual(before);
  expect(buildDailyFinanceReportInput({ ...rows, inventoryRows: [], productRows: [{ current_stock: 7, cost_price: 6 }] }).inventoryValue).toBe(0);
});

it('values the warehouse from each product\'s latest count when the report day was not counted', () => {
  const input = buildDailyFinanceReportInput({
    clubName: 'Test', businessDate: '2026-09-03', businessDateLabel: '3 September',
    cashRows: [], stockRows: [], stockPurchaseRows: [], expenseRows: [], debtRows: [],
    inventoryRows: [
      { product_id: 'cola', date: '2026-09-01', closing_stock: 10, cost_price: 8, products: { tracks_inventory: true } },
      { product_id: 'cola', date: '2026-09-02', closing_stock: 7, cost_price: 6, products: { tracks_inventory: true } },
      { product_id: 'water', date: '2026-08-20', closing_stock: 5, cost_price: 2, products: { tracks_inventory: true } },
    ],
    previousMonthInventoryRows: [
      { product_id: 'cola', date: '2026-08-03', closing_stock: 26, cost_price: 2, products: { tracks_inventory: true } },
    ],
  });

  expect(input.inventoryValue).toBe(52);
  expect(input.inventoryValueChange).toBe(0);
});

describe('calculateOutstandingDebtsAsOf', () => {
  const debts = [
    { id: 'old', date: '2026-09-01', amount: 100, remaining_amount: 0, status: 'paid' },
    { id: 'partial', date: '2026-09-02', amount: 50, remaining_amount: 20, status: 'partial' },
    { id: 'future', date: '2026-09-05', amount: 70, remaining_amount: 70, status: 'unpaid' },
  ];

  it('matches the live balance when nothing was recorded after the report date', () => {
    expect(calculateOutstandingDebtsAsOf(debts, [], '2026-09-10')).toBe(90);
  });

  it('rewinds later payments and ignores later debts for a past report date', () => {
    expect(calculateOutstandingDebtsAsOf(debts, [
      { debt_id: 'old', date: '2026-09-04', amount: 60 },
      { debt_id: 'partial', date: '2026-09-04', amount: 30 },
      { debt_id: 'future', date: '2026-09-06', amount: 0 },
    ], '2026-09-03')).toBe(110);
  });
});

describe('promo giveaways in the daily report', () => {
  const baseRows = {
    clubName: 'Pixel',
    businessDate: '2026-09-29',
    businessDateLabel: '29 сентября 2026',
    cashRows: [],
    stockRows: [],
    stockPurchaseRows: [],
    expenseRows: [],
    debtRows: [],
  };

  it('lists given-away units with their promotion and cost, largest first', () => {
    const input = buildDailyFinanceReportInput({
      ...baseRows,
      giveawayRows: [
        { product_id: 'a', giveaway_quantity: '2', giveaway_cost: '12000', products: { name: 'Fanta' }, promotions: null },
        { product_id: 'b', giveaway_quantity: 20, giveaway_cost: 60000, products: [{ name: 'Coca-Cola' }], promotions: [{ name: 'Cola for 50k' }] },
        { product_id: 'c', giveaway_quantity: 0, giveaway_cost: 0, products: { name: 'Water' }, promotions: null },
      ],
    });
    expect(input.promoGiveaways).toEqual([
      { productName: 'Coca-Cola', promotionName: 'Cola for 50k', quantity: 20, cost: 60000 },
      { productName: 'Fanta', promotionName: null, quantity: 2, cost: 12000 },
    ]);
    const text = formatRussianDailyFinanceReport(input);
    expect(text).toContain('🎁 Бонусы по акциям: 22 шт., себестоимость 72 000 UZS');
    expect(text).toContain('  • Coca-Cola: 20 шт. — Cola for 50k');
    expect(text).toContain('  • Fanta: 2 шт.');
    expect(formatRussianDailyFinanceReportCaption(input)).toContain('🎁 Бонусы по акциям: 22 шт.');

    const none = buildDailyFinanceReportInput({ ...baseRows, giveawayRows: [] });
    expect(none.promoGiveaways).toEqual([]);
    expect(formatRussianDailyFinanceReport(none)).not.toContain('Бонусы');
    expect(buildDailyFinanceReportInput(baseRows).promoGiveaways).toBeUndefined();
  });
});

describe('bar write-offs in the daily report', () => {
  const baseRows = {
    clubName: 'Pixel',
    businessDate: '2026-11-13',
    businessDateLabel: '13 ноября 2026',
    cashRows: [],
    stockRows: [],
    stockPurchaseRows: [],
    expenseRows: [],
    debtRows: [],
  };

  it('lists shortage and expired write-offs with their loss, largest first, and skips free-text adjustments', () => {
    const input = buildDailyFinanceReportInput({
      ...baseRows,
      writeOffRows: [
        { product_id: 'a', adjustment_quantity: '-2', adjustment_reason: 'shortage', cost_price: '5874.35', products: { name: 'Coca cola 0,5' } },
        { product_id: 'b', adjustment_quantity: -3, adjustment_reason: 'expired: sour', cost_price: 7333, products: [{ name: 'Saber' }] },
        { product_id: 'c', adjustment_quantity: -1, adjustment_reason: 'broken bottle', cost_price: 2000, products: { name: 'Water' } },
      ],
    });
    expect(input.stockWriteOffs).toEqual([
      { productName: 'Saber', kind: 'expired', note: 'sour', quantity: 3, cost: 21999 },
      { productName: 'Coca cola 0,5', kind: 'shortage', note: '', quantity: 2, cost: 11748.7 },
    ]);
    const text = formatRussianDailyFinanceReport(input);
    expect(text).toContain('🗑 Списания бара: 5 шт., убыток 33 748 UZS');
    expect(text).toContain('  • Saber — просрочка (sour): 3 шт., 21 999 UZS');
    expect(text).toContain('  • Coca cola 0,5 — недостача: 2 шт., 11 749 UZS');
    expect(text).not.toContain('Water');
    expect(formatRussianDailyFinanceReportCaption(input)).toContain('🗑 Списания бара: 33 748 UZS');

    const none = buildDailyFinanceReportInput({ ...baseRows, writeOffRows: [] });
    expect(formatRussianDailyFinanceReport(none)).not.toContain('Списания');
    expect(buildDailyFinanceReportInput(baseRows).stockWriteOffs).toBeUndefined();
  });
});

describe('worth checking in the daily report', () => {
  const baseRows = {
    clubName: 'Pixel',
    businessDate: '2026-11-20',
    businessDateLabel: '20 ноября 2026',
    cashRows: [],
    stockRows: [],
    stockPurchaseRows: [],
    expenseRows: [],
    debtRows: [],
  };
  const day = { from: '2026-11-20', to: '2026-11-20' };
  const duplicate = (count: number, date = '2026-11-20'): MoneyCheck => ({
    kind: 'duplicate_expense', severity: 'danger', side: 'game_club', date, range: { from: date, to: date },
    category: 'supplies', amount: 150_000, count, recordIds: Array.from({ length: count }, (_, index) => `e${index}`),
  });
  const lowDay = (side: 'game_club' | 'bar', severity: 'warning' | 'danger', amount: number): MoneyCheck => ({
    kind: 'low_income_day', severity, side, date: '2026-11-20', range: day, amount, usual: 1_000_000,
  });
  const spike: MoneyCheck = {
    kind: 'category_spike', severity: 'danger', side: 'game_club', date: null, range: { from: '2026-11-01', to: '2026-11-20' },
    category: 'repair', amount: 900_000, usual: 200_000,
  };
  const shortage: MoneyCheck = {
    kind: 'repeated_shortage', severity: 'warning', side: 'bar', date: null, range: { from: '2026-11-01', to: '2026-11-20' },
    category: 'shortage', amount: 90_000, count: 4,
  };

  it('keeps only the report date\'s duplicates and low days, danger first, at most three', () => {
    const checks = reportDayMoneyChecks([
      lowDay('game_club', 'warning', 550_000),
      spike,
      shortage,
      duplicate(2, '2026-11-19'),
      lowDay('bar', 'danger', 100_000),
      duplicate(2),
      { ...duplicate(3), category: 'cleaning', amount: 40_000, recordIds: ['x', 'y', 'z'] },
    ], '2026-11-20');
    expect(REPORT_MONEY_CHECK_MAX).toBe(3);
    expect(checks.map((check) => [check.kind, check.side, check.amount])).toEqual([
      ['duplicate_expense', 'game_club', 150_000],
      ['low_income_day', 'bar', 100_000],
      ['duplicate_expense', 'game_club', 40_000],
    ]);
  });

  it('adds a "Стоит проверить" block and caption line only when something was found', () => {
    const input = buildDailyFinanceReportInput({
      ...baseRows,
      moneyChecks: [duplicate(2), lowDay('game_club', 'warning', 550_000), spike],
    });
    const text = formatRussianDailyFinanceReport(input);
    expect(text).toContain([
      '🔎 Стоит проверить:',
      '  • 🔴 Повтор расхода: Расходные материалы и хозтовары: 150 000 UZS (2 одинаковые записи из денег клуба)',
      '  • 🟡 Низкий доход клуба: 550 000 UZS (обычно 1 000 000 UZS в этот день недели)',
    ].join('\n'));
    expect(text).not.toContain('Ремонт');
    expect(formatRussianDailyFinanceReportCaption(input)).toContain('🔎 Стоит проверить: 2');

    const bar = buildDailyFinanceReportInput({ ...baseRows, moneyChecks: [lowDay('bar', 'danger', 100_000), { ...duplicate(5), side: 'bar' }] });
    expect(formatRussianDailyFinanceReport(bar)).toContain('🔴 Низкие продажи бара: 100 000 UZS');
    expect(formatRussianDailyFinanceReport(bar)).toContain('(5 одинаковых записей из денег бара)');

    for (const rows of [{ ...baseRows, moneyChecks: [] }, { ...baseRows, moneyChecks: [spike, shortage] }, baseRows]) {
      const none = buildDailyFinanceReportInput(rows);
      expect(formatRussianDailyFinanceReport(none)).not.toContain('Стоит проверить');
      expect(formatRussianDailyFinanceReportCaption(none)).not.toContain('Стоит проверить');
    }
    expect(buildDailyFinanceReportInput(baseRows).moneyChecks).toBeUndefined();
  });

  it('falls back to the category key for a category without a Russian label', () => {
    expect(reportMoneyCheckText({ ...duplicate(2), category: 'custom_thing' }).title).toBe('Повтор расхода: custom_thing');
  });
});

describe('internet payment reminder', () => {
  it('fires on the day before the payment day', () => {
    expect(internetPaymentDueDate('2026-10-19', 20)).toBe('2026-10-20');
    expect(internetPaymentDueDate('2026-10-18', 20)).toBeNull();
    expect(internetPaymentDueDate('2026-10-20', 20)).toBeNull();
    expect(internetPaymentDueDate('2026-10-31', 1)).toBe('2026-11-01');
    expect(internetPaymentDueDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('moves a day past the end of a short month to its last day', () => {
    expect(internetPaymentDueDate('2026-02-27', 31)).toBe('2026-02-28');
    expect(internetPaymentDueDate('2028-02-28', 30)).toBe('2028-02-29');
    expect(internetPaymentDueDate('2026-09-29', 31)).toBe('2026-09-30');
    expect(internetPaymentDueDate('2026-10-30', 31)).toBe('2026-10-31');
    expect(internetPaymentDueDate('2026-10-29', 30)).toBe('2026-10-30');
  });

  it('is off without a valid payment day', () => {
    expect(internetPaymentDueDate('2026-10-19', null)).toBeNull();
    expect(internetPaymentDueDate('2026-10-19', undefined)).toBeNull();
    expect(internetPaymentDueDate('2026-10-19', 0)).toBeNull();
    expect(internetPaymentDueDate('2026-10-19', 32)).toBeNull();
  });

  it('adds the reminder to the text report and caption on the send date before the payment day', () => {
    const baseRows = {
      clubName: 'Main Game Club',
      businessDate: '2026-10-18',
      businessDateLabel: '18 октября 2026',
      cashRows: [],
      stockRows: [],
      stockPurchaseRows: [],
      expenseRows: [],
      debtRows: [],
      internetPaymentDay: 20,
    };
    const input = buildDailyFinanceReportInput({ ...baseRows, sendDate: '2026-10-19' });

    expect(input.internetPaymentDueDate).toBe('2026-10-20');
    expect(formatRussianDailyFinanceReport(input).split('\n').at(-1)).toMatch(/^🌐 Завтра оплата интернета \(20 .+ 2026\)$/);
    expect(formatRussianDailyFinanceReportCaption(input).split('\n')[0]).toMatch(/^🌐 Завтра оплата интернета/);

    const otherDay = buildDailyFinanceReportInput({ ...baseRows, sendDate: '2026-10-18' });
    expect(otherDay.internetPaymentDueDate).toBeNull();
    expect(formatRussianDailyFinanceReport(otherDay)).not.toContain('интернет');
    expect(formatRussianDailyFinanceReportCaption(otherDay)).not.toContain('интернет');
  });
});

describe('PlayStation in the daily report', () => {
  it('lists PlayStation money per calendar day and its running daily average', () => {
    const series = buildDailyPlaystationIncomeSeries([
      { date: '2026-11-01', cash_income: 0, terminal_income: 0, card_income: 0, playstation_income: 30_000 },
      { date: '2026-11-03', cash_income: 0, terminal_income: 0, card_income: 0, playstation_income: 60_000 },
      { date: '2026-11-03', cash_income: 0, terminal_income: 0, card_income: 0, playstation_income: null as never },
    ], { from: '2026-11-01', to: '2026-11-03' });
    expect(series).toEqual([
      { date: '2026-11-01', amount: 30_000 },
      { date: '2026-11-02', amount: 0 },
      { date: '2026-11-03', amount: 60_000 },
    ]);
    expect(runningDailyAverage(series).map((point) => point.amount)).toEqual([30_000, 15_000, 30_000]);
  });

  it('writes the month and its daily average, with the change only when last month had sales', () => {
    const base = {
      clubName: 'Club', businessDateLabel: '3 ноября 2026', gameClubIncome: 0, computerIncome: 0, debtIncome: 0, playstationIncome: 0,
      barSales: 0, barCost: 0, gameClubProfit: 0, barProfit: 0, stockPurchases: 0, gameClubExpenses: 0, barExpenses: 0,
      gameClubExpenseCategories: [], barExpenseCategories: [], monthToDateRevenue: 0, gameClubMoneyLeft: 0,
      averageDailyGameClubIncome: 0, barMoneyLeft: 0, inventoryValue: 0, activeDebts: 0,
    };
    const text = formatRussianDailyFinanceReport({ ...base, monthPlaystationIncome: 90_000, averageDailyPlaystationIncome: 30_000, averageDailyPlaystationIncomeChange: 25 });
    expect(text).toContain('🕹 PlayStation за месяц: 90 000 UZS');
    expect(text).toContain('🕹 Средние продажи PlayStation в день: 30 000 UZS (+25% к прошлому месяцу)');
    const noChange = formatRussianDailyFinanceReport({ ...base, monthPlaystationIncome: 90_000, averageDailyPlaystationIncome: 30_000, averageDailyPlaystationIncomeChange: null });
    expect(noChange).toContain('🕹 Средние продажи PlayStation в день: 30 000 UZS\n');
    expect(formatRussianDailyFinanceReport(base)).not.toContain('PlayStation за месяц');
    // The bar's average per day sits with its other month figures, like the club's and PlayStation's.
    expect(formatRussianDailyFinanceReport({ ...base, averageDailyBarSales: 625_824, averageDailyBarSalesChange: 8 }))
      .toContain('🍫 Средние продажи бара в день: 625 824 UZS (+8% к прошлому месяцу)');
  });
});

describe('stock corrections in the daily report', () => {
  const rows = [
    { product_id: 'a', adjustment_quantity: -2, adjustment_reason: 'shortage', cost_price: 5000, products: { name: 'Cola' } },
    { product_id: 'b', adjustment_quantity: 3, adjustment_reason: 'correction: нашли', cost_price: 4000, products: { name: 'Snickers' } },
    { product_id: 'c', adjustment_quantity: 1, adjustment_reason: 'found', cost_price: 4000, products: { name: 'Mars' } },
  ];

  it('keeps corrections apart from write-offs and ignores free-text adjustments', () => {
    expect(summarizeStockWriteOffsForReport(rows)).toEqual([
      { productName: 'Cola', kind: 'shortage', note: '', quantity: 2, cost: 10000 },
    ]);
    expect(summarizeStockCorrectionsForReport(rows)).toEqual([
      { productName: 'Snickers', note: 'нашли', quantity: 3, value: 12000 },
    ]);
  });

  it('captions the write-offs image with the loss and the units corrected', () => {
    const input = {
      businessDateLabel: '18 ноября 2026',
      stockWriteOffs: summarizeStockWriteOffsForReport(rows),
      stockCorrections: summarizeStockCorrectionsForReport(rows),
    } as Parameters<typeof formatRussianStockAdjustmentsCaption>[0];
    expect(hasStockAdjustments(input)).toBe(true);
    expect(hasStockAdjustments({ stockWriteOffs: [], stockCorrections: [] })).toBe(false);
    expect(formatRussianStockAdjustmentsCaption(input).split('\n')).toEqual([
      '🗑 Списания и корректировки бара',
      'Рабочий день: 18 ноября 2026',
      'Списано: 2 шт., убыток 10 000 UZS',
      'Корректировки: +3 шт. (больше ожидаемого)',
    ]);
  });
});

describe('nextDailyReportBusinessDateIso', () => {
  it('judges a 07:50 Tashkent run at the 08:00 report for a club whose day starts at 08:00', () => {
    // 02:50 UTC = 07:50 Tashkent: the business day is still the 21st, but the
    // 08:00 report will carry the 21st.
    expect(nextDailyReportBusinessDateIso(new Date('2026-11-22T02:50:00.000Z'), 8)).toBe('2026-11-21');
    expect(previousClubBusinessDateIso(new Date('2026-11-22T02:50:00.000Z'), 8)).toBe('2026-11-20');
  });

  it('matches the last closed day once the report time has passed', () => {
    expect(nextDailyReportBusinessDateIso(new Date('2026-11-22T09:00:00.000Z'), 8)).toBe('2026-11-21');
    expect(nextDailyReportBusinessDateIso(new Date('2026-11-22T02:50:00.000Z'), 6)).toBe('2026-11-21');
  });
});

describe('summarizeMonthMoney', () => {
  const expense = (id: string, category: string, amount: number, extra: Record<string, unknown> = {}) => ({
    id, date: '2026-11-10', amount, category, comment: null, created_at: '2026-11-10T10:00:00Z', ...extra,
  });

  it('splits club money by method and totals investments, reserve, withdrawals and salaries', () => {
    const result = summarizeMonthMoney({
      month: '2026-11',
      cashRows: [{ date: '2026-11-10', cash_income: 1_000_000, terminal_income: 3_000_000, card_income: 0, playstation_income: 200_000 }],
      expenseRows: [
        expense('a', 'investments', 500_000, { payment_method: 'cash' }),
        expense('b', 'investments', 100_000, { payment_source: 'bar' }),
        expense('c', 'salary', 400_000, { payment_method: 'terminal' }),
      ],
      debtPaymentRows: [{ date: '2026-11-11', amount: 50_000, payment_method: 'cash' }],
      exchangeRows: [{ id: 'x', date: '2026-11-12', from_method: 'terminal', to_method: 'cash', from_amount: 300_000, to_amount: 300_000 } as never],
      reserveMoves: [
        { date: '2026-11-12', source: 'game_club', method: 'terminal', amount: 1_000_000 },
        { date: '2026-11-15', source: 'game_club', method: 'terminal', amount: -200_000 },
      ],
      withdrawalRows: [
        { period_month: '2026-11-01', source: 'game_club', amount: 700_000 },
        { period_month: '2026-11-01', source: 'bar', amount: '50000' },
        { period_month: '2026-10-01', source: 'game_club', amount: 999_999 },
      ],
    });

    expect(result.byMethod).toEqual({ cash: 850_000, terminal: 1_500_000, card: 0, playstation: 200_000 });
    expect(result.invested).toEqual({ gameClub: 500_000, bar: 100_000 });
    expect(result.reserve).toEqual({ deposited: 1_000_000, returned: 200_000, net: 800_000 });
    expect(result.withdrawn).toEqual({ gameClub: 700_000, bar: 50_000 });
    expect(result.salaries).toBe(400_000);
  });

  it('leaves withdrawals out when they could not be read', () => {
    const result = summarizeMonthMoney({ month: '2026-11', cashRows: [], expenseRows: [], debtPaymentRows: [] });
    expect(result.withdrawn).toBeUndefined();
    expect(result.reserve.net).toBe(0);
  });
});

describe('payments of the day', () => {
  const flow = (moneyIn: number, moneyOut = 0) => ({ moneyIn, moneyOut, net: moneyIn - moneyOut });
  const zero = flow(0);

  it('shows enabled methods, any other method with money, and PlayStation only when it moved money', () => {
    expect(selectDayPaymentMethods(
      { cash: flow(500_000, 20_000), terminal: zero, card: flow(0, 10_000), playstation: zero },
      ['cash', 'terminal'],
    )).toEqual([
      { method: 'cash', moneyIn: 500_000, moneyOut: 20_000, net: 480_000 },
      { method: 'terminal', moneyIn: 0, moneyOut: 0, net: 0 },
      { method: 'card', moneyIn: 0, moneyOut: 10_000, net: -10_000 },
    ]);
    expect(selectDayPaymentMethods(
      { cash: flow(1), terminal: zero, card: zero, playstation: flow(300_000) },
      ['cash'],
    ).map((item) => item.method)).toEqual(['cash', 'playstation']);
  });

  it('is empty when no method moved money that day', () => {
    expect(selectDayPaymentMethods({ cash: zero, terminal: zero, card: zero, playstation: zero }, ['cash', 'terminal', 'card']))
      .toEqual([]);
  });

  it('builds the day section from the report day only and lists it in the text report', () => {
    const input = buildDailyFinanceReportInput({
      clubName: 'Pixel',
      businessDate: '2026-11-20',
      businessDateLabel: '20 ноября 2026',
      cashRows: [{ date: '2026-11-20', cash_income: 900_000, terminal_income: 400_000, card_income: 0, playstation_income: 0 }],
      stockRows: [],
      stockPurchaseRows: [],
      expenseRows: [
        { id: 'a', date: '2026-11-20', amount: 100_000, category: 'supplies', payment_method: 'cash', payment_source: 'game_club', comment: null, created_at: '' },
        { id: 'b', date: '2026-11-20', amount: 70_000, category: 'supplies', payment_method: 'cash', payment_source: 'bar', comment: null, created_at: '' },
      ],
      debtRows: [],
      // Month-to-date payments: only the report day's count.
      debtPaymentRows: [
        { date: '2026-11-03', amount: 999_000, payment_method: 'terminal' },
        { date: '2026-11-20', amount: 50_000, payment_method: 'cash' },
      ],
      enabledPaymentMethods: ['cash', 'terminal'],
    });

    expect(input.dayByMethod).toEqual([
      { method: 'cash', moneyIn: 950_000, moneyOut: 100_000, net: 850_000 },
      { method: 'terminal', moneyIn: 400_000, moneyOut: 0, net: 400_000 },
    ]);
    const lines = formatRussianDailyFinanceReport(input).split('\n');
    expect(lines).toContain('💳 Оплаты за день (клуб, без бара):');
    expect(lines).toContain('  • Наличные: 850 000 UZS (приход 950 000 UZS, расход 100 000 UZS)');
    expect(lines).toContain('  • Терминал: 400 000 UZS (приход 400 000 UZS, расход 0 UZS)');
    expect(lines.some((line) => line.includes('Карта:') && line.includes('приход'))).toBe(false);
    expect(formatRussianDailyFinanceReportCaption(input)).not.toContain('Оплаты за день');
  });

  it('shows every method when the enabled list is unknown, and nothing on a day without money', () => {
    const base = {
      clubName: 'Pixel', businessDate: '2026-11-20', businessDateLabel: '20 ноября 2026',
      stockRows: [], stockPurchaseRows: [], expenseRows: [], debtRows: [],
    };
    const withMoney = buildDailyFinanceReportInput({
      ...base,
      cashRows: [{ date: '2026-11-20', cash_income: 10_000, terminal_income: 0, card_income: 0 }],
    });
    expect(withMoney.dayByMethod?.map((item) => item.method)).toEqual(['cash', 'terminal', 'card']);

    const empty = buildDailyFinanceReportInput({ ...base, cashRows: [] });
    expect(empty.dayByMethod).toEqual([]);
    expect(formatRussianDailyFinanceReport(empty)).not.toContain('Оплаты за день');
  });
});

describe('where the money is, in the caption', () => {
  const baseRows = {
    clubName: 'Pixel',
    businessDate: '2026-11-24',
    businessDateLabel: '24 ноября 2026',
    // The month so far: cash 3 000 000, terminal 1 000 000, PlayStation 234 000.
    cashRows: [{ date: '2026-11-24', cash_income: 1_000_000, terminal_income: 0, card_income: 0, playstation_income: 0 }],
    monthCashRows: [
      { date: '2026-11-10', cash_income: 2_000_000, terminal_income: 1_000_000, card_income: 0, playstation_income: 234_000 },
      { date: '2026-11-24', cash_income: 1_000_000, terminal_income: 0, card_income: 0, playstation_income: 0 },
    ],
    stockRows: [],
    stockPurchaseRows: [],
    expenseRows: [],
    debtRows: [],
    sendDate: '2026-11-25',
  };
  const collectedMoves = [
    { kind: 'collect' as const, id: 'c1', date: '2026-11-20', method: 'cash' as const, amount: 2_500_000, comment: null, createdBy: 'u', createdAt: '2026-11-20T10:00:00Z' },
    { kind: 'expense' as const, id: 'e1', date: '2026-11-21', method: 'cash' as const, amount: -500_000, comment: null, createdBy: 'u', createdAt: '2026-11-21T10:00:00Z' },
  ];

  it('opens with the till, collected money, the reserve and all of it, then the flags', () => {
    const input = buildDailyFinanceReportInput({
      ...baseRows,
      collectedMoves,
      reserveHoldings: { sums: 15_000_000, usd: 1_200 },
      moneyChecks: [],
    });
    expect(input.moneyWhereabouts).toEqual({
      kassa: 2_234_000, collected: 2_000_000, reserveSums: 15_000_000, reserveUsd: 1_200, totalSums: 19_234_000,
    });
    expect(formatRussianDailyFinanceReportCaption({ ...input, promoGiveaways: [{ productName: 'Cola', promotionName: null, quantity: 2, cost: 6_000 }] }).split('\n')).toEqual([
      '👛 У администратора: 2 234 000 UZS',
      '💼 Собрано: 2 000 000 UZS',
      '🏦 В резерве: 15 000 000 UZS + $1 200',
      '💰 Всего денег: 19 234 000 UZS + $1 200',
      '🎁 Бонусы по акциям: 2 шт.',
    ]);
  });

  it('shows no dollars when the USD account is empty', () => {
    const input = buildDailyFinanceReportInput({ ...baseRows, collectedMoves: [], reserveHoldings: { sums: 0, usd: 0 } });
    expect(formatRussianDailyFinanceReportCaption(input)).toBe([
      '👛 У администратора: 4 234 000 UZS',
      '💼 Собрано: 0 UZS',
      '🏦 В резерве: 0 UZS',
      '💰 Всего денег: 4 234 000 UZS',
    ].join('\n'));
  });

  it('leaves the lines out, never shows them as 0, when any part could not be read', () => {
    for (const rows of [{ collectedMoves }, { reserveHoldings: { sums: 1, usd: 0 } }, {}]) {
      const input = buildDailyFinanceReportInput({ ...baseRows, ...rows });
      expect(input.moneyWhereabouts).toBeUndefined();
      expect(formatRussianDailyFinanceReportCaption(input)).toBe('');
    }
  });
});
