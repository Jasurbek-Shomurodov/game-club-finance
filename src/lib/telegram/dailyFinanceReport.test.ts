import { describe, expect, it } from 'vitest';
import {
  buildDailyFinanceReportInput,
  buildDailyGameClubIncomeSeries,
  calculateOutstandingDebtsAsOf,
  formatRussianDailyFinanceReportCaption,
  formatRussianDailyFinanceReport,
  monthStartIso,
  previousComparableMonthRangeIso,
} from './dailyFinanceReport';
import { isIsoDate, previousClubBusinessDateIso } from './sendDailyFinanceReport';

describe('formatRussianDailyFinanceReport', () => {
  it('formats the two-line photo caption without duplicating the club name', () => {
    expect(formatRussianDailyFinanceReportCaption({
      clubName: 'Main Game Club',
      businessDateLabel: '27 августа 2026',
      dailyRevenue: 0,
      gameClubIncome: 0,
      computerIncome: 0,
      debtIncome: 0,
      playstationIncome: 0,
      barSales: 0,
      barCost: 0,
      grossProfit: 0,
      netProfit: 0,
      stockPurchases: 0,
      totalExpenses: 0,
      gameClubExpenses: 0,
      barExpenses: 0,
      gameClubExpenseCategories: [],
      barExpenseCategories: [],
      salaryCosts: 0,
      kpiCosts: 0,
      rentCosts: 0,
      utilitiesCosts: 0,
      otherOperatingCosts: 0,
      monthToDateRevenue: 0,
      gameClubMoneyLeft: 0,
      averageDailyGameClubIncome: 0,
      barMoneyLeft: 0,
      inventoryValue: 0,
      activeDebts: 0,
    })).toBe('📊 Ежедневный финансовый отчёт\nРабочий день: 27 августа 2026');
  });

  it('formats the saved Russian Telegram daily finance template', () => {
    const message = formatRussianDailyFinanceReport({
        clubName: 'Pixel Game Zone',
        businessDateLabel: '4 июля 2026',
        dailyRevenue: 931_000,
        gameClubIncome: 0,
        computerIncome: 0,
        debtIncome: 0,
        playstationIncome: 0,
        barSales: 931_000,
        barCost: 400_000,
        grossProfit: 531_000,
        netProfit: 531_000,
        stockPurchases: 668_000,
        totalExpenses: 0,
        gameClubExpenses: 0,
        barExpenses: 0,
        gameClubExpenseCategories: [],
        barExpenseCategories: [],
        salaryCosts: 0,
        kpiCosts: 0,
        rentCosts: 0,
        utilitiesCosts: 0,
        otherOperatingCosts: 0,
        monthToDateRevenue: 4_000_000,
        gameClubMoneyLeft: 3_024_000,
        averageDailyGameClubIncome: 756_000,
        barMoneyLeft: 2_311_000,
        inventoryValue: 8_473_309,
        activeDebts: 0,
      });

    expect(message).toContain('💳 Выручка за день: 931 000 UZS');
    expect(message).toContain('🍫 Продажи бара: 931 000 UZS (100%)');
    expect(message).toContain('📈 Валовая прибыль: 531 000 UZS');
    expect(message).toContain('✅ Чистая прибыль: 531 000 UZS');
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
      dailyRevenue: 1_140_000,
      gameClubIncome: 840_000,
      computerIncome: 790_000,
      debtIncome: 90_000,
      playstationIncome: 50_000,
      barSales: 300_000,
      barCost: 200_000,
      grossProfit: 940_000,
      netProfit: 780_000,
      stockPurchases: 100_000,
      totalExpenses: 160_000,
      gameClubExpenses: 120_000,
      barExpenses: 40_000,
      gameClubExpenseCategories: [
        { name: 'Зарплата', amount: 80_000 },
        { name: 'Elektrenergiya', amount: 40_000 },
      ],
      barExpenseCategories: [{ name: 'Ремонт', amount: 40_000 }],
      salaryCosts: 80_000,
      kpiCosts: 0,
      rentCosts: 0,
      utilitiesCosts: 40_000,
      otherOperatingCosts: 40_000,
      monthToDateRevenue: 1_940_000,
      gameClubMoneyLeft: 1_750_000,
      averageDailyGameClubIncome: 485_000,
      barMoneyLeft: 560_000,
      inventoryValue: 50_000,
      activeDebts: 90_000,
    });
  });

  it('formats expense category breakdowns under each money source', () => {
    expect(
      formatRussianDailyFinanceReport({
        clubName: 'Main Game Club',
        businessDateLabel: '3 июля 2026',
        dailyRevenue: 2_496_000,
        gameClubIncome: 1_904_000,
        computerIncome: 1_904_000,
        debtIncome: 0,
        playstationIncome: 0,
        barSales: 592_000,
        barCost: 250_000,
        grossProfit: 2_246_000,
        netProfit: 1_622_000,
        stockPurchases: 0,
        totalExpenses: 624_000,
        gameClubExpenses: 564_000,
        barExpenses: 60_000,
        gameClubExpenseCategories: [
          { name: 'Зарплата', amount: 340_000 },
          { name: 'Пополнение Номера', amount: 224_000 },
        ],
        barExpenseCategories: [{ name: 'Еда / Напитки', amount: 60_000 }],
        salaryCosts: 340_000,
        kpiCosts: 0,
        rentCosts: 0,
        utilitiesCosts: 0,
        otherOperatingCosts: 284_000,
        monthToDateRevenue: 5_000_000,
        gameClubMoneyLeft: 2_941_000,
        averageDailyGameClubIncome: 980_333,
        barMoneyLeft: 1_084_000,
        inventoryValue: 8_473_309,
        activeDebts: 0,
      }),
    ).toContain(`💸 Расходы: 624 000 UZS
  • Из денег клуба: 564 000 UZS
    - Зарплата: 340 000 UZS
    - Пополнение Номера: 224 000 UZS
  • Из денег бара: 60 000 UZS
    - Еда / Напитки: 60 000 UZS`);
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
    expect(input.utilitiesCosts).toBe(3_541_000);
    expect(input.otherOperatingCosts).toBe(25_000);
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
    expect(input.monthTotalIncome).toBe(3_000_000);
    expect(input.monthGameClubProfit).toBe(2_000_000);
    expect(input.monthSankey?.sources).toEqual([
      { key: 'computers', amount: 2_000_000 },
      { key: 'bar', amount: 1_000_000 },
    ]);
    expect(input.monthSankey?.income).toBe(3_000_000);
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
    expect(formatRussianDailyFinanceReportCaption(input)).toBe([
      '📊 Ежедневный финансовый отчёт',
      'Рабочий день: 29 сентября 2026',
      '⚠️ Заканчивается на складе: 2',
    ].join('\n'));

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
