import { describe, expect, it } from 'vitest';
import { calculateSalaries, displayedRate, type SalaryEmployee, type SalaryEntry, type SalaryRate } from './salaries';

const employee: SalaryEmployee = { id: 'one', club_id: 'club', name: 'Employee', job_title: '', joined_on: '2026-09-01' };
const rate: SalaryRate = { id: 'rate', employee_id: 'one', effective_date: '2026-09-01', salary_type: 'daily', amount: 100, kpi_percent: 10, active: true };
const profit = (earned: number, month = '2026-09') => ({ period_month: `${month}-01`, game_club_earned: earned, bar_earned: 0, game_club_withdrawn: 0, bar_withdrawn: 0 });
const bonus = (employeeId: string, amount: number, date: string): SalaryEntry => ({
  id: `bonus-${employeeId}`, employee_id: employeeId, date, kind: 'bonus', amount, comment: '', payment_method: null, payment_source: null, created_at: '',
});

describe('owner-profit KPI without a profit row', () => {
  it('pays no KPI for a month the owner profit snapshot does not list', () => {
    // Ten days at 100 a day; nothing was withdrawn because the month has no row at all.
    const row = calculateSalaries({
      employees: [employee], rates: [{ ...rate, kpi_basis: 'owner_profit' }], entries: [], monthlyProfit: [], throughDate: '2026-09-10',
    }).one[0];
    expect(row).toMatchObject({ base: 1000, kpi: 0, kpiProfit: 0, earned: 1000, balance: 1000 });
  });

  it('does not borrow another month withdrawals', () => {
    const august = { ...profit(0, '2026-08'), game_club_withdrawn: 9000, bar_withdrawn: 4000 };
    const row = calculateSalaries({
      employees: [employee], rates: [{ ...rate, kpi_basis: 'owner_profit' }], entries: [], monthlyProfit: [august], throughDate: '2026-09-10',
    }).one[0];
    expect(row.kpi).toBe(0);
  });
});

describe('an employee whose terms change pools mid-month', () => {
  it('adds KPI from each group and reports the profit of the larger share', () => {
    // 1-7 September: 10% of Game Club + Bar; 8-10 September: 10% of Game Club only.
    const rows = calculateSalaries({
      employees: [employee],
      rates: [rate, { ...rate, id: 'later', effective_date: '2026-09-08', kpi_bar: false }],
      entries: [],
      monthlyProfit: [{ ...profit(12000), bar_earned: 6000 }],
      throughDate: '2026-09-10',
    }).one;

    // Fixed pay 1000 splits 700 / 300 by days. Shares are 10% x 7/10 = 7% and 10% x 3/10 = 3%.
    // Both pools: (18000 - 700) / 1.07 = 16168.22; Game Club only: (12000 - 300) / 1.03 = 11359.22.
    // KPI = 16168.22 x 7% + 11359.22 x 3% = 1131.78 + 340.78 = 1472.55.
    expect(rows[0]).toMatchObject({ base: 1000, kpi: 1472.55, kpiProfit: 16168.22, earned: 2472.55, effectiveKpiPercent: 10 });
    // Every worked day gets a share and the days add up to the month KPI.
    const days = Object.values(rows[0].kpiByDay);
    expect(days).toHaveLength(10);
    expect(Math.round(days.reduce((sum, amount) => sum + amount, 0) * 100) / 100).toBe(1472.55);
  });
});

describe('a future Game Club income rate', () => {
  const left: SalaryEmployee = { ...employee, id: 'two', name: 'Left' };
  const leftRates: SalaryRate[] = [
    { ...rate, id: 'left', employee_id: 'two', kpi_percent: 0 },
    { ...rate, id: 'left-off', employee_id: 'two', effective_date: '2026-09-10', active: false },
  ];
  const incomeRate = (effectiveDate: string): SalaryRate => ({
    ...rate, id: 'left-income', employee_id: 'two', effective_date: effectiveDate, amount: 0, kpi_percent: 5, kpi_basis: 'game_club_income',
  });
  const october = (rates: SalaryRate[]) => calculateSalaries({
    employees: [employee, left],
    rates: [rate, ...rates],
    entries: [bonus('two', 1100, '2026-10-05')],
    monthlyProfit: [profit(0), profit(12000, '2026-10')],
    throughDate: '2026-10-10',
  });

  it('keeps an inactive employee bonus in their profit group until the income rate starts', () => {
    // The income terms start on 20 October, after the period: the bonus is still a cost of the profit group.
    const rows = october([...leftRates, incomeRate('2026-10-20')]);
    // (12000 - 1000 base - 1100 bonus) / 1.1 = 9000, so the other employee earns 900.
    expect(rows.one[1]).toMatchObject({ base: 1000, kpi: 900, kpiProfit: 9000 });
    expect(rows.two[1]).toMatchObject({ base: 0, bonus: 1100, kpi: 0, balance: 1100 });
  });

  it('takes the bonus out of every profit group once the income rate is in force', () => {
    // From 8 October the employee is paid on income, which deducts nothing from any profit group.
    const rows = october([...leftRates, incomeRate('2026-10-08')]);
    // (12000 - 1000) / 1.1 = 10000.
    expect(rows.one[1]).toMatchObject({ base: 1000, kpi: 1000, kpiProfit: 10000 });
    expect(rows.two[1]).toMatchObject({ base: 0, bonus: 1100, kpi: 0, balance: 1100 });
  });
});

describe('displayedRate for staff who have not started', () => {
  const upcoming = (id: string, effectiveDate: string): SalaryRate => ({ ...rate, id, employee_id: 'two', effective_date: effectiveDate });

  it('shows the earliest future rate whatever order the rows arrive in', () => {
    expect(displayedRate([upcoming('first', '2026-10-05'), upcoming('raise', '2026-10-20')], 'two', '2026-09-20')?.id).toBe('first');
    expect(displayedRate([upcoming('raise', '2026-10-20'), upcoming('first', '2026-10-05')], 'two', '2026-09-20')?.id).toBe('first');
  });

  it('ignores deleted future rates', () => {
    const rates = [{ ...upcoming('deleted', '2026-10-01'), deleted_at: '2026-09-19T00:00:00Z' }, upcoming('live', '2026-10-05')];
    expect(displayedRate(rates, 'two', '2026-09-20')?.id).toBe('live');
  });
});
