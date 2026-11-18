import { describe, expect, it } from 'vitest';
import { calculateDashboardTotals, calculateGameClubMoneyLeftByPaymentMethod, type ExpenseRow } from './dashboardMetrics';
import { buildBarMoneyDetailRows, buildGameClubMoneyDetailRows } from './moneyDetails';
import { buildMoneyReport } from './moneyReport';
import { isReservePaidExpense, parseReserveMoves, reservedNetBy, type ReserveMove } from './reserveMoves';

const DAY = '2026-11-05';
const cash = [{ date: DAY, cash_income: 1_000_000, terminal_income: 500_000, card_income: 0, playstation_income: 0 }];
const expense = (id: string, amount: number, overrides: Partial<ExpenseRow> = {}): ExpenseRow => ({
  id, date: DAY, amount, category: 'equipment', payment_method: 'cash', payment_source: 'game_club', comment: null,
  created_at: `${DAY}T10:00:00Z`, ...overrides,
});
const moves: ReserveMove[] = [
  { date: DAY, source: 'game_club', method: 'cash', amount: 300_000 },
  { date: DAY, source: 'game_club', method: 'terminal', amount: -50_000 },
  { date: DAY, source: 'bar', method: null, amount: 20_000 },
];

describe('reserve moves (156)', () => {
  it('tells a purchase the reserve paid from one Game Club or Bar money paid', () => {
    expect(isReservePaidExpense({ paid_from_reserve: true, payment_method: 'cash' })).toBe(true);
    expect(isReservePaidExpense({ payment_method: 'usd' })).toBe(true);
    expect(isReservePaidExpense({ paid_from_reserve: false, payment_method: 'cash' })).toBe(false);
    expect(isReservePaidExpense({})).toBe(false);
  });

  it('nets what each side and method put in', () => {
    expect(reservedNetBy(moves, 'game_club')).toBe(250_000);
    expect(reservedNetBy(moves, 'game_club', 'cash')).toBe(300_000);
    expect(reservedNetBy(moves, 'game_club', 'terminal')).toBe(-50_000);
    expect(reservedNetBy(moves, 'bar')).toBe(20_000);
  });

  it('reads the RPC payload and drops malformed rows', () => {
    expect(parseReserveMoves(null)).toEqual([]);
    expect(parseReserveMoves([
      { date: DAY, source: 'game_club', method: 'usd', amount: '640000' },
      { date: DAY, source: 'bar', method: null, amount: 1 },
      { date: DAY, source: 'shop', amount: 1 },
      { source: 'bar', amount: 1 },
      { date: DAY, source: 'bar', amount: 'x' },
    ])).toEqual([
      { date: DAY, source: 'game_club', method: 'usd', amount: 640_000 },
      { date: DAY, source: 'bar', method: null, amount: 1 },
    ]);
  });

  it('keeps a reserve purchase in expenses and profit but out of money left; a deposit leaves it', () => {
    const rows = [expense('own', 100_000), expense('reserve', 400_000, { paid_from_reserve: true }), expense('usd', 260_000, { payment_method: 'usd' })];
    const totals = calculateDashboardTotals(cash, [], [], rows, [], [], [], [], moves);
    expect(totals.gameClubExpenses).toBe(760_000);
    expect(totals.gameClubProfit).toBe(1_500_000 - 760_000);
    // 1 500 000 collected − 100 000 Game Club paid − 250 000 net into the reserve.
    expect(totals.gameClubMoneyLeft).toBe(1_150_000);
    // No bar sales: only the 20 000 put into the reserve left the Bar.
    expect(totals.barIncome).toBe(-20_000);
  });

  it('takes deposits off their method and never a reserve purchase', () => {
    const rows = [expense('own', 100_000), expense('reserve', 400_000, { paid_from_reserve: true })];
    expect(calculateGameClubMoneyLeftByPaymentMethod(cash, rows, [], [], moves)).toEqual({
      cash: 1_000_000 - 100_000 - 300_000,
      terminal: 500_000 + 50_000,
      card: 0,
      playstation: 0,
    });
  });

  it('shows the reserve on the Reports method cards, and Game Club left matches the dashboard', () => {
    const rows = [expense('own', 100_000), expense('reserve', 400_000, { paid_from_reserve: true }), expense('usd', 260_000, { payment_method: 'usd' })];
    const report = buildMoneyReport(cash, rows, [], [], [], [], moves);
    expect(report.paymentMethods.cash).toMatchObject({ expenses: 100_000, reserved: 300_000, left: 600_000 });
    expect(report.paymentMethods.terminal).toMatchObject({ reserved: -50_000, left: 550_000 });
    expect(report.paymentMethods.card).not.toHaveProperty('reserved');
    expect(report.gameClubExpenses).toBe(760_000);
    expect(report.gameClubLeft).toBe(calculateDashboardTotals(cash, [], [], rows, [], [], [], [], moves).gameClubMoneyLeft);
    expect(report.barLeft).toBe(-20_000);
  });

  it('explains money left with an Into reserve line on the day money moved', () => {
    const rows = [expense('own', 100_000), expense('reserve', 400_000, { paid_from_reserve: true })];
    const later = { date: '2026-11-06', source: 'game_club' as const, method: 'card', amount: 10_000 };
    const days = buildGameClubMoneyDetailRows(cash, [], rows, ['cash', 'terminal'], [...moves, later]);
    expect(days.map((day) => day.date)).toEqual([DAY, '2026-11-06']);
    expect(days[0].deductions).toEqual([
      { kind: 'expense', category: 'equipment', comment: null, amount: 100_000 },
      { kind: 'reserve', amount: 250_000 },
    ]);
    expect(days[0]).toMatchObject({ deductionsTotal: 350_000, moneyLeft: 1_150_000 });
    expect(days[1]).toMatchObject({ collectedTotal: 0, deductions: [{ kind: 'reserve', amount: 10_000 }], moneyLeft: -10_000 });

    const bar = buildBarMoneyDetailRows([], [], [expense('bar', 5_000, { payment_source: 'bar', paid_from_reserve: true })], moves);
    expect(bar).toEqual([expect.objectContaining({ date: DAY, deductions: [{ kind: 'reserve', amount: 20_000 }], moneyLeft: -20_000 })]);
  });
});
