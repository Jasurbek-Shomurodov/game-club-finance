import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { MoneyCheck } from '../calculations/moneyChecks';
import type { DailyFinanceReportInput } from './dailyFinanceReport';
import {
  buildDailyFinanceReportSvg,
  buildForecastReportSvg,
  buildMonthlyFinanceReportSvg,
  buildStockAdjustmentsReportSvg,
  renderDailyFinanceReportPng,
  renderMonthlyFinanceReportPng,
  renderStockAdjustmentsReportPng,
} from './dailyFinanceReportImage';

function reportInput(): DailyFinanceReportInput {
  return {
    clubName: 'Main Game Club',
    businessDateLabel: '27 августа 2026',
    gameClubIncome: 1_431_000,
    computerIncome: 1_431_000,
    debtIncome: 0,
    playstationIncome: 0,
    barSales: 375_500,
    barCost: 210_000,
    gameClubProfit: 905_000,
    barProfit: 4_500,
    stockPurchases: 489_948,
    gameClubExpenses: 526_000,
    barExpenses: 161_000,
    gameClubExpenseCategories: [
      { name: 'Зарплата', amount: 480_000 },
      { name: 'SKIDKA & bonus', amount: 46_000 },
    ],
    barExpenseCategories: [
      { name: 'Sasiska', amount: 145_000 },
      { name: 'NON', amount: 16_000 },
    ],
    monthToDateRevenue: 58_240_000,
    gameClubMoneyLeft: 37_830_000,
    averageDailyGameClubIncome: 2_323_741,
    barMoneyLeft: 10_086_526,
    inventoryValue: 23_749_204,
    averageDailyGameClubIncomeChange: 12,
    barMoneyLeftChange: -5,
    inventoryValueChange: 20,
    activeDebts: 474_000,
    monthGameClubSankey: {
      sources: [{ key: 'computers', amount: 58_240_000 }],
      targets: [
        { key: 'salary', amount: 9_600_000 },
        { key: 'mystery_fee', amount: 520_000 },
        { key: '__game_club_left', amount: 48_120_000 },
      ],
      total: 58_240_000,
      income: 58_240_000,
    },
    monthBarSankey: {
      sources: [{ key: 'bar', amount: 10_086_526 }, { key: 'shortfall', amount: 113_474 }],
      targets: [
        { key: '__bar_cost', amount: 4_200_000 },
        { key: 'food_drinks', amount: 6_000_000 },
      ],
      total: 10_200_000,
      income: 10_200_000,
    },
  };
}

function fontHasCodePoint(font: Buffer, codePoint: number): boolean {
  const tableCount = font.readUInt16BE(4);
  let cmapOffset = -1;

  for (let index = 0; index < tableCount; index += 1) {
    const tableOffset = 12 + index * 16;
    if (font.toString('ascii', tableOffset, tableOffset + 4) === 'cmap') {
      cmapOffset = font.readUInt32BE(tableOffset + 8);
      break;
    }
  }

  if (cmapOffset < 0) return false;
  const encodingCount = font.readUInt16BE(cmapOffset + 2);

  for (let index = 0; index < encodingCount; index += 1) {
    const subtableOffset = cmapOffset + font.readUInt32BE(cmapOffset + 8 + index * 8);
    if (font.readUInt16BE(subtableOffset) !== 4) continue;
    const segmentCount = font.readUInt16BE(subtableOffset + 6) / 2;
    const endCodesOffset = subtableOffset + 14;
    const startCodesOffset = endCodesOffset + segmentCount * 2 + 2;

    for (let segment = 0; segment < segmentCount; segment += 1) {
      const start = font.readUInt16BE(startCodesOffset + segment * 2);
      const end = font.readUInt16BE(endCodesOffset + segment * 2);
      if (codePoint >= start && codePoint <= end) return true;
    }
  }

  return false;
}

describe('daily finance report image', () => {
  it('builds the day image: today per business, its breakdown and nothing monthly', () => {
    const svg = buildDailyFinanceReportSvg(reportInput());

    expect(svg).toContain('width="1600"');
    expect(svg).toContain('height="1054"');
    expect(svg).toContain('ФИНАНСЫ ДНЯ');
    expect(svg).toContain('Main Game Club · Рабочий день: 27 августа 2026');
    expect(svg).toContain('ДОХОД ЗА ДЕНЬ');
    expect(svg.match(/в среднем \/ день/g)).toHaveLength(3);
    expect(svg).toContain('РАСХОДЫ КЛУБА');
    expect(svg).toContain('526 000 UZS');
    expect(svg).toContain('161 000 UZS');
    expect(svg).toContain('SKIDKA &amp; bonus');
    expect(svg).toContain('Чистая прибыль клуба');
    expect(svg).toContain('905 000<tspan');
    expect(svg).toContain('Чистая прибыль бара');
    expect(svg).toContain('4 500<tspan');
    expect(svg).toContain('>12%</text>');
    // The month lives on its own image.
    expect(svg).not.toContain('КУДА УХОДЯТ ДЕНЬГИ КЛУБА');
    expect(svg).not.toContain('ДИНАМИКА ДОХОДА КЛУБА ЗА МЕСЯЦ');
    expect(svg).not.toContain('КЛЮЧЕВЫЕ ПОКАЗАТЕЛИ');
    expect(svg).not.toContain('▲');
    expect(svg).toContain('font-family="Noto Sans"');
    expect(buildDailyFinanceReportSvg(reportInput())).toBe(svg);
  });

  it('builds the month image with escaped labels and exact calculated values', () => {
    const svg = buildMonthlyFinanceReportSvg(reportInput());

    expect(svg).toContain('width="1600"');
    expect(svg).toContain('height="1948"');
    expect(svg).toContain('ИТОГИ МЕСЯЦА');
    expect(svg).toContain('Main Game Club · с 1-го числа по 27 августа 2026');
    expect(svg).toContain('КУДА УХОДЯТ ДЕНЬГИ КЛУБА');
    expect(svg).toContain('КУДА УХОДЯТ ДЕНЬГИ БАРА');
    expect(svg).toContain('Клуб · <tspan font-weight="800" fill="#F7FAF8">58,2\u00a0млн</tspan>');
    expect(svg).toContain('Бар · <tspan font-weight="800" fill="#F7FAF8">10,2\u00a0млн</tspan>');
    expect(svg).toContain('Остаток · <tspan font-weight="800" fill="#F7FAF8">48,1\u00a0млн</tspan>');
    expect(svg).toContain('Убыток (не покрыт) · ');
    expect(svg).toContain('Еда / Напитки · ');
    // Club and bar money are separate businesses: no pooled hub, profit or share of a combined total.
    expect(svg).not.toContain('Доход · ');
    expect(svg).not.toContain('Прибыль · ');
    expect(svg).not.toContain('ПО НАПРАВЛЕНИЯМ');
    expect(svg).toContain('Компьютеры · <tspan font-weight="800" fill="#F7FAF8">58,2\u00a0млн</tspan>');
    expect(svg).toContain('Продажи бара · ');
    expect(svg).toContain('Себестоимость бара · ');
    expect(svg).toContain('Зарплата · <tspan font-weight="800" fill="#F7FAF8">9,6\u00a0млн</tspan>');
    expect(svg).toContain('mystery fee · <tspan font-weight="800" fill="#F7FAF8">520\u00a0тыс.</tspan>');
    expect(svg).toContain('ДИНАМИКА ДОХОДА КЛУБА ЗА МЕСЯЦ');
    expect(svg).toContain('КЛЮЧЕВЫЕ ПОКАЗАТЕЛИ');
    expect(svg).toContain('37 830 000');
    expect(svg).toContain('23 749 204');
    expect(svg).toContain('474 000');
    expect(svg).toContain('>12%</text>');
    expect(svg).toContain('>5%</text>');
    // Today's breakdown lives on the day image.
    expect(svg).not.toContain('РАСХОДЫ КЛУБА');
    expect(svg).not.toContain('ДОХОД ЗА ДЕНЬ');
    expect(buildMonthlyFinanceReportSvg(reportInput())).toBe(svg);
  });

  it('tracks PlayStation on its own card: day, month, average per day and daily sales with their running average', () => {
    const input: DailyFinanceReportInput = {
      ...reportInput(),
      playstationIncome: 70_000,
      monthPlaystationIncome: 160_000,
      averageDailyPlaystationIncome: 53_333,
      averageDailyPlaystationIncomeChange: 18,
      monthDailyPlaystationIncome: [
        { date: '2026-08-01', amount: 30_000 },
        { date: '2026-08-02', amount: 0 },
        { date: '2026-08-03', amount: 130_000 },
      ],
    };
    const day = buildDailyFinanceReportSvg(input);
    const svg = buildMonthlyFinanceReportSvg(input);
    // PlayStation is a tile beside the club and the bar, each with its average per day.
    expect(day).toContain('>PLAYSTATION</text>');
    expect(day).toContain('>53 333 UZS</text>');
    expect(day).toContain('>18%</text>');
    expect(svg).toContain('ПРОДАЖИ PLAYSTATION ЗА МЕСЯЦ');
    // Two days with sales draw two bars; the day without sales draws none.
    expect(svg.match(/fill="#B09FFA" fill-opacity="0.8"\/>/g)).toHaveLength(3);
    // The card pushes the rest of the month image down.
    expect(svg).toContain('height="2332"');
    expect(svg).not.toContain('Нет продаж PlayStation за месяц');
  });

  it('says so when the month has no PlayStation sales, and leaves the card out without the series', () => {
    const empty = buildMonthlyFinanceReportSvg({ ...reportInput(), monthPlaystationIncome: 0, averageDailyPlaystationIncome: 0, monthDailyPlaystationIncome: [{ date: '2026-08-01', amount: 0 }] });
    expect(empty).toContain('Нет продаж PlayStation за месяц');
    expect(buildMonthlyFinanceReportSvg(reportInput())).not.toContain('ПРОДАЖИ PLAYSTATION ЗА МЕСЯЦ');
  });

  it('plots the month daily income trend with day labels', () => {
    const svg = buildMonthlyFinanceReportSvg({
      ...reportInput(),
      monthDailyGameClubIncome: [
        { date: '2026-08-01', amount: 1_000_000 },
        { date: '2026-08-02', amount: 2_000_000 },
        { date: '2026-08-03', amount: 1_500_000 },
      ],
    });

    expect(svg).toContain('<polyline points="');
    expect(svg).toContain('>1 авг</text>');
    expect(svg).toContain('>3 авг</text>');
    expect(svg).toContain('2 млн');
    expect(buildMonthlyFinanceReportSvg(reportInput())).toContain('Нет данных за месяц');
  });

  it('shows an empty money flow when the month has no income or spending', () => {
    const svg = buildMonthlyFinanceReportSvg({
      ...reportInput(),
      monthGameClubSankey: undefined,
      monthBarSankey: undefined,
    });
    const nothing = { sources: [], targets: [], total: 0, income: 0 };
    const empty = buildMonthlyFinanceReportSvg({
      ...reportInput(),
      monthGameClubSankey: nothing,
      monthBarSankey: nothing,
    });

    expect(svg).toContain('КУДА УХОДЯТ ДЕНЬГИ КЛУБА');
    expect(svg).toContain('КУДА УХОДЯТ ДЕНЬГИ БАРА');
    expect(svg).not.toContain('Клуб · ');
    expect(svg).not.toContain('Бар · ');
    // Once in each money flow and once in the empty daily income trend.
    expect(svg.match(/Нет данных за месяц/g)).toHaveLength(3);
    expect(empty).toBe(svg);
  });

    it('renders the SVG into a real PNG buffer', async () => {
    const png = await renderDailyFinanceReportPng(reportInput());
    const metadata = await sharp(png).metadata();

    expect(png.subarray(0, 8)).toEqual(Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]));
    expect(metadata).toMatchObject({
      format: 'png',
      width: 1600,
      channels: 4,
    });
    expect(metadata.height).toBe(1054);
    const month = await sharp(await renderMonthlyFinanceReportPng(reportInput())).metadata();
    expect(month).toMatchObject({ format: 'png', width: 1600, height: 1948 });
  });

  it('grows the report when the club has more expense rows', () => {
    const compact = buildDailyFinanceReportSvg(reportInput());
    const expanded = buildDailyFinanceReportSvg({
      ...reportInput(),
      gameClubExpenseCategories: [
        { name: 'Зарплата', amount: 1 },
        { name: 'KPI', amount: 1 },
        { name: 'Аренда', amount: 1 },
        { name: 'Коммунальные услуги', amount: 1 },
        { name: 'Прочие расходы', amount: 1 },
      ],
    });

    expect(compact).toContain('height="1054"');
    expect(expanded).toContain('height="1168"');
  });

  it('adds a low-stock card only when products are running out', () => {
    const lowStockProducts = Array.from({ length: 14 }, (_, index) => ({
      name: index === 0 ? 'Очень длинное название напитка без сахара 0,5 л' : `Товар ${index}`,
      currentStock: index === 0 ? 0 : index,
      threshold: 20,
      level: index === 0 ? 'out' as const : 'low' as const,
    }));
    const empty = buildDailyFinanceReportSvg({ ...reportInput(), lowStockProducts: [] });
    const withAlerts = buildDailyFinanceReportSvg({ ...reportInput(), lowStockProducts });

    expect(empty).toContain('height="1054"');
    expect(empty).not.toContain('ЗАКАНЧИВАЕТСЯ НА СКЛАДЕ');
    expect(withAlerts).toContain('ЗАКАНЧИВАЕТСЯ НА СКЛАДЕ · 14');
    expect(withAlerts).toContain('нет в наличии');
    expect(withAlerts).toContain('1 шт. · порог 20');
    expect(withAlerts).toContain('Очень длинное название напи…');
    expect(withAlerts).toContain('Товар 11');
    expect(withAlerts).not.toContain('Товар 12');
    expect(withAlerts).toContain('и ещё 2');
    expect(withAlerts).toContain('height="1466"');
  });

  it('configures application-owned Noto Sans before the static Sharp import', () => {
    const rendererSource = readFileSync(
      resolve(process.cwd(), 'src/lib/telegram/dailyFinanceReportImage.ts'),
      'utf8',
    );
    const fontConfigSource = readFileSync(
      resolve(process.cwd(), 'src/lib/telegram/reportFontConfig.ts'),
      'utf8',
    );

    expect(rendererSource.indexOf("import './reportFontConfig';"))
      .toBeLessThan(rendererSource.indexOf("import sharp from 'sharp';"));
    expect(fontConfigSource).toContain("'src', 'assets', 'fonts'");
    expect(fontConfigSource).toContain('process.env.FONTCONFIG_FILE = configPath');
    expect(fontConfigSource).toContain('process.env.FONTCONFIG_PATH = configDirectory');
    expect(rendererSource).toContain('assertReportFontsAvailable();');
  });

  it('bundles real TrueType Noto Sans files instead of relying on host fonts', () => {
    for (const fileName of [
      'NotoSans-Regular.ttf',
      'NotoSans-Bold.ttf',
      'NotoSans-ExtraBold.ttf',
    ]) {
      const font = readFileSync(resolve(process.cwd(), 'src/assets/fonts', fileName));
      expect(font.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x01, 0x00, 0x00]));
      expect(font.byteLength).toBeGreaterThan(500_000);
      expect(fontHasCodePoint(font, 'Ё'.codePointAt(0)!)).toBe(true);
      expect(fontHasCodePoint(font, 'я'.codePointAt(0)!)).toBe(true);
    }
  });

  it('draws write-offs and corrections on their own image, not on the report', async () => {
    const stockWriteOffs = [
      { productName: 'Saber', kind: 'expired' as const, note: 'sour', quantity: 3, cost: 21999 },
      { productName: 'Coca cola', kind: 'shortage' as const, note: '', quantity: 2, cost: 11749 },
    ];
    const stockCorrections = [{ productName: 'Snickers', note: 'в коробке', quantity: 4, value: 16000 }];
    const report = buildDailyFinanceReportSvg({ ...reportInput(), stockWriteOffs, stockCorrections });
    expect(report).not.toContain('СПИСАНИЯ БАРА');

    const svg = buildStockAdjustmentsReportSvg({ ...reportInput(), stockWriteOffs, stockCorrections });
    expect(svg).toContain('СПИСАНИЯ И КОРРЕКТИРОВКИ БАРА');
    expect(svg).toContain('СПИСАНИЯ БАРА · 5 шт.');
    expect(svg).toContain('Saber — просрочка (sour)');
    expect(svg).toContain('Coca cola — недостача');
    expect(svg).toContain('убыток 33 748 UZS');
    expect(svg).toContain('КОРРЕКТИРОВКИ · +4 шт.');
    expect(svg).toContain('Snickers — корректировка (в коробке)');

    expect(await renderStockAdjustmentsReportPng({ ...reportInput(), stockWriteOffs: [], stockCorrections: [] })).toBeNull();
    const png = await renderStockAdjustmentsReportPng({ ...reportInput(), stockWriteOffs, stockCorrections });
    expect((await sharp(png!).metadata()).format).toBe('png');
  });

  it('shows only the corrections list when nothing was written off', () => {
    const svg = buildStockAdjustmentsReportSvg({ ...reportInput(), stockCorrections: [{ productName: 'Snickers', note: '', quantity: 1, value: 4000 }] });
    expect(svg).toContain('КОРРЕКТИРОВКИ · +1 шт.');
    expect(svg).not.toContain('СПИСАНИЯ БАРА ·');
  });

  it('adds a promo giveaway card only when bonuses were handed out', () => {
    const promoGiveaways = Array.from({ length: 10 }, (_, index) => ({
      productName: `Напиток ${index}`,
      promotionName: index === 0 ? 'Cola for 50k' : null,
      quantity: 10 - index,
      cost: (10 - index) * 3000,
    }));
    const empty = buildDailyFinanceReportSvg({ ...reportInput(), promoGiveaways: [] });
    const withPromo = buildDailyFinanceReportSvg({ ...reportInput(), promoGiveaways });

    expect(empty).toContain('height="1054"');
    expect(empty).not.toContain('БОНУСЫ ПО АКЦИЯМ');
    expect(withPromo).toContain('БОНУСЫ ПО АКЦИЯМ · 55 шт.');
    expect(withPromo).toContain('Напиток 0 — Cola for 50k');
    expect(withPromo).toContain('Напиток 7');
    expect(withPromo).not.toContain('Напиток 8');
    expect(withPromo).toContain('и ещё 2');
    expect(withPromo).toContain('себестоимость 165 000 UZS');
  });

  it('adds a "worth checking" card only when the report date has checks, and leaves the layout alone otherwise', async () => {
    const moneyChecks: MoneyCheck[] = [
      {
        kind: 'duplicate_expense', severity: 'danger', side: 'game_club', date: '2026-08-27',
        range: { from: '2026-08-27', to: '2026-08-27' }, category: 'supplies', amount: 150_000, count: 2, recordIds: ['a', 'b'],
      },
      {
        kind: 'low_income_day', severity: 'warning', side: 'bar', date: '2026-08-27',
        range: { from: '2026-08-27', to: '2026-08-27' }, amount: 300_000, usual: 600_000,
      },
    ];
    const plain = buildDailyFinanceReportSvg(reportInput());
    expect(buildDailyFinanceReportSvg({ ...reportInput(), moneyChecks: [] })).toBe(plain);
    expect(plain).not.toContain('СТОИТ ПРОВЕРИТЬ');

    const withChecks = buildDailyFinanceReportSvg({ ...reportInput(), moneyChecks });
    // 96 header + 2 rows of 40 + 16, and a 24 gap.
    expect(withChecks).toContain('height="1270"');
    expect(withChecks).toContain('СТОИТ ПРОВЕРИТЬ · 2');
    expect(withChecks).toContain('Повтор расхода: Расходные материалы и хозтовары');
    expect(withChecks).toContain('2 одинаковые записи из денег клуба');
    expect(withChecks).toContain('Низкие продажи бара');
    expect(withChecks).toContain('150 000 UZS');

    const lowStockProducts = [{ name: 'Cola', currentStock: 0, threshold: 5, level: 'out' as const }];
    const lowStockOnly = buildDailyFinanceReportSvg({ ...reportInput(), lowStockProducts });
    const both = buildDailyFinanceReportSvg({ ...reportInput(), lowStockProducts, moneyChecks });
    const heightOf = (svg: string) => Number(/height="(\d+)"/.exec(svg)?.[1]);
    expect(heightOf(both) - heightOf(lowStockOnly)).toBe(216);
    expect(both.indexOf('СТОИТ ПРОВЕРИТЬ')).toBeLessThan(both.indexOf('ЗАКАНЧИВАЕТСЯ НА СКЛАДЕ'));

    const png = await sharp(await renderDailyFinanceReportPng({ ...reportInput(), moneyChecks })).metadata();
    expect(png).toMatchObject({ format: 'png', width: 1600, height: 1270 });
  });
});

describe('payments of the day section', () => {
  const dayByMethod = [
    { method: 'cash' as const, moneyIn: 950_000, moneyOut: 100_000, net: 850_000 },
    { method: 'terminal' as const, moneyIn: 450_000, moneyOut: 0, net: 450_000 },
    { method: 'playstation' as const, moneyIn: 100_000, moneyOut: 300_000, net: -200_000 },
  ];

  it('draws a tile per method with its net, what came in and went out, and its share of the takings', () => {
    const svg = buildDailyFinanceReportSvg({ ...reportInput(), dayByMethod });

    expect(svg).toContain('ОПЛАТЫ ЗА ДЕНЬ');
    expect(svg).toContain('клуб · без бара');
    expect(svg).toContain('>НАЛИЧНЫЕ<');
    expect(svg).toContain('>ТЕРМИНАЛ<');
    expect(svg).toContain('>PLAYSTATION<');
    // Card is not in the list (disabled and no money that day), so it has no tile.
    expect(svg).not.toContain('>КАРТА<');
    expect(svg).toContain('850 000<tspan');
    expect(svg).toContain('>950 000 UZS<');
    expect(svg).toContain('>100 000 UZS<');
    expect(svg).toContain('−200 000<tspan');
    expect(svg).toContain('>63%<');
    expect(svg).toContain('>30%<');
    expect(svg).toContain('>7%<');
    // 72 heading + 214 tile + 28, and a 24 gap.
    expect(svg).toContain('height="1392"');
    expect(svg.indexOf('Чистая прибыль бара')).toBeLessThan(svg.indexOf('ОПЛАТЫ ЗА ДЕНЬ'));
  });

  it('sits above "worth checking" and is left out when no method moved money', async () => {
    const moneyChecks: MoneyCheck[] = [{
      kind: 'low_income_day', severity: 'warning', side: 'bar', date: '2026-08-27',
      range: { from: '2026-08-27', to: '2026-08-27' }, amount: 300_000, usual: 600_000,
    }];
    const both = buildDailyFinanceReportSvg({ ...reportInput(), dayByMethod, moneyChecks });
    expect(both.indexOf('ОПЛАТЫ ЗА ДЕНЬ')).toBeLessThan(both.indexOf('СТОИТ ПРОВЕРИТЬ'));

    const plain = buildDailyFinanceReportSvg(reportInput());
    expect(buildDailyFinanceReportSvg({ ...reportInput(), dayByMethod: [] })).toBe(plain);
    expect(plain).not.toContain('ОПЛАТЫ ЗА ДЕНЬ');

    const png = await sharp(await renderDailyFinanceReportPng({ ...reportInput(), dayByMethod })).metadata();
    expect(png).toMatchObject({ format: 'png', width: 1600, height: 1392 });
  });
});

describe('month money section', () => {
  it('shows each method the club holds and where the month money went', () => {
    const svg = buildMonthlyFinanceReportSvg({
      ...reportInput(),
      monthMoney: {
        byMethod: { cash: 5_226_000, terminal: 32_013_000, card: 0, playstation: 1_690_000 },
        invested: { gameClub: 9_950_000, bar: 0 },
        reserve: { deposited: 7_200_000, returned: 0, net: 7_200_000 },
        withdrawn: { gameClub: 0, bar: 0 },
        salaries: 9_120_000,
      },
    });

    expect(svg).toContain('ДЕНЬГИ ЗА МЕСЯЦ');
    expect(svg).toContain('НАЛИЧНЫЕ');
    expect(svg).toContain('ТЕРМИНАЛ');
    expect(svg).not.toContain('>КАРТА<');
    expect(svg).toContain('Всего: 38 929 000 UZS');
    expect(svg).toContain('ИНВЕСТИРОВАНО');
    expect(svg).toContain('В РЕЗЕРВ');
    expect(svg).toContain('ВЫВЕДЕНО ВЛАДЕЛЬЦАМИ');
    expect(svg).toContain('ЗАРПЛАТЫ');
  });

  it('is absent when the report has no month money', () => {
    expect(buildMonthlyFinanceReportSvg(reportInput())).not.toContain('ДЕНЬГИ ЗА МЕСЯЦ');
    expect(buildDailyFinanceReportSvg(reportInput())).not.toContain('ДЕНЬГИ ЗА МЕСЯЦ');
  });
});

describe('month-end forecast', () => {
  const side = (incomeToDate: number, projectedIncome: number | null, lastMonthIncome: number) => ({
    daysCounted: projectedIncome === null ? 0 : 20,
    incomeToDate,
    profitToDate: incomeToDate / 2,
    projectedIncome,
    projectedProfit: projectedIncome === null ? null : projectedIncome / 2,
    lastMonthIncome,
    lastMonthProfit: lastMonthIncome / 2,
  });

  const days = [1, 2, 3].map((day) => ({
    day,
    gameClubActual: day <= 2 ? day * 3_000_000 : null,
    gameClubProjected: day >= 2 ? day * 3_000_000 : null,
    gameClubLastMonth: day * 2_500_000,
    barActual: null,
    barProjected: null,
    barLastMonth: null,
    playstationActual: day <= 2 ? day * 50_000 : null,
    playstationProjected: day >= 2 ? day * 50_000 : null,
    playstationLastMonth: null,
  }));
  const forecast = {
    daysInMonth: 30,
    daysLeft: 8,
    gameClub: side(60_000_000, 90_000_000, 80_000_000),
    playstation: side(1_000_000, 1_500_000, 0),
    bar: side(0, null, 0),
    days,
  };

  it('draws its own image: month-end figures beside last month and running totals', () => {
    const svg = buildForecastReportSvg({ ...reportInput(), monthForecast: forecast })!;

    expect(svg).toContain('ПРОГНОЗ МЕСЯЦА');
    expect(svg).toContain('Main Game Club · с 1-го числа по 27 августа 2026');
    expect(svg).toContain('ПРОГНОЗ НА КОНЕЦ МЕСЯЦА');
    expect(svg).toContain('90 000 000<tspan');
    expect(svg).toContain('45 000 000<tspan');
    expect(svg).toContain('>13%</text>');
    expect(svg).toContain('нет данных');
    expect(svg).toContain('ДОХОД КЛУБА С НАЧАЛА МЕСЯЦА');
    expect(svg).toContain('PLAYSTATION С НАЧАЛА МЕСЯЦА');
    expect(svg).toContain('stroke-dasharray="10 8"');
    // The bar has nothing this month or last: its chart says so.
    expect(svg).toContain('Нет данных за месяц');
  });

  it('stays off the day and month images, and is absent without a forecast', () => {
    const input = { ...reportInput(), monthForecast: forecast };
    expect(buildDailyFinanceReportSvg(input)).not.toContain('ПРОГНОЗ');
    expect(buildMonthlyFinanceReportSvg(input)).not.toContain('ПРОГНОЗ НА КОНЕЦ МЕСЯЦА');
    expect(buildForecastReportSvg(reportInput())).toBeNull();
  });
});
