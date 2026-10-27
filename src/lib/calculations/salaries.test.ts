import { describe, expect, it } from 'vitest';
import { applySalaryPaymentChanges, calculateSalaries, combineSalaryMonths, displayedRate, employeeStatus, rateInForce, salaryBalance, canDeleteSalaryRate, type SalaryEmployee, type SalaryEntry, type SalaryRate } from './salaries';

const employee: SalaryEmployee = { id: 'one', club_id: 'club', name: 'Employee', job_title: '', joined_on: '2026-09-01' };
const rate: SalaryRate = { id: 'rate', employee_id: 'one', effective_date: '2026-09-01', salary_type: 'daily', amount: 100, kpi_percent: 10, active: true };
function entry(kind: SalaryEntry['kind'], amount: number, date = '2026-09-10'): SalaryEntry {
  return { id: kind, employee_id: 'one', date, kind, amount, comment: '', payment_method: kind === 'payment' ? 'cash' : null, payment_source: kind === 'payment' ? 'game_club' : null, created_at: '' };
}
const profit = (earned: number, month = '2026-09') => ({ period_month: `${month}-01`, game_club_earned: earned, bar_earned: 0, game_club_withdrawn: 0, bar_withdrawn: 0 });
function calculate(overrides: Partial<Parameters<typeof calculateSalaries>[0]> = {}) {
  return calculateSalaries({ employees: [employee], rates: [rate], entries: [], monthlyProfit: [profit(12000)], throughDate: '2026-09-10', ...overrides });
}

describe('salary accrual and owner profit after all salary costs', () => {
  it('solves KPI after base AND KPI costs, independently of owner withdrawals', () => {
    const row = calculate({ monthlyProfit: [{ ...profit(12000), game_club_withdrawn: 8000 }] }).one[0];
    expect(row).toMatchObject({ base: 1000, kpi: 1000, kpiProfit: 10000, earned: 2000, balance: 2000 });
  });
  it('records payment once against balance without changing KPI even across months', () => {
    const original = calculate().one[0];
    const paid = calculate({ entries: [entry('payment', 500)], monthlyProfit: [profit(11500)] }).one[0];
    expect(paid.kpi).toBe(original.kpi);
    expect(paid.balance).toBe(1500);
    const later = calculate({ throughDate: '2026-10-01', entries: [entry('payment', 500, '2026-10-01')], monthlyProfit: [profit(12000), profit(-500, '2026-10')] }).one;
    expect(later[0].paid).toBe(0);
    expect(later[1]).toMatchObject({ base: 100, paid: 500, kpi: 0, balance: -400 });
  });
  it('bonuses add and fines deduct, including the effect on after-salary profit', () => {
    const row = calculate({ entries: [entry('bonus', 300), entry('fine', 80)] }).one[0];
    expect(row).toMatchObject({ base: 1000, bonus: 300, fine: 80, kpi: 980, earned: 2200 });
  });
  it('uses a common remaining-profit base for multiple employees', () => {
    const second = { ...employee, id: 'two' };
    const rows = calculate({ employees: [employee, second], rates: [rate, { ...rate, id: 'r2', employee_id: 'two', kpi_percent: 20 }], monthlyProfit: [profit(15000)] });
    expect(rows.one[0]).toMatchObject({ base: 1000, kpi: 1000, kpiProfit: 10000 });
    expect(rows.two[0]).toMatchObject({ base: 1000, kpi: 2000, kpiProfit: 10000 });
  });
  it('prorates monthly salary using actual month length, including leap February', () => {
    const rows = calculate({ employees: [{ ...employee, joined_on: '2024-02-15' }], rates: [{ ...rate, effective_date: '2024-02-15', salary_type: 'monthly', amount: 2900, kpi_percent: 0 }], throughDate: '2024-02-29', monthlyProfit: [] }).one;
    expect(rows[0].base).toBe(1500);
  });
  it('preserves earlier rates and stops/restarts accrual on effective dates', () => {
    const rows = calculate({ rates: [rate, { ...rate, id: '2', effective_date: '2026-09-05', amount: 200, kpi_percent: 20 }, { ...rate, id: '3', effective_date: '2026-09-08', active: false }, { ...rate, id: '4', effective_date: '2026-09-10', amount: 300, kpi_percent: 0 }] }).one;
    expect(rows[0].base).toBe(1300); // 4*100 + 3*200 + 1*300
    expect(rows[0].effectiveKpiPercent).toBe(10); // (4*10 + 3*20) / 10
  });
  it('weights KPI for mid-month joining and ignores future payments', () => {
    const row = calculate({ employees: [{ ...employee, joined_on: '2026-09-06' }], rates: [{ ...rate, effective_date: '2026-09-06' }], entries: [entry('payment', 999, '2026-09-11')] }).one[0];
    expect(row).toMatchObject({ base: 500, effectiveKpiPercent: 5, paid: 0 });
  });
  it('does not accrue KPI on a loss and preserves overpayments as credit', () => {
    const rows = calculate({ monthlyProfit: [profit(-2000)], entries: [entry('payment', 1500)] }).one;
    expect(rows[0].kpi).toBe(0);
    expect(salaryBalance(rows)).toBe(-500);
  });
  it('carries balances across months without using another month profit for KPI', () => {
    const rows = calculate({ throughDate: '2026-10-02', monthlyProfit: [profit(14000), profit(0, '2026-10')] }).one;
    expect(rows[0]).toMatchObject({ base: 3000, kpi: 1000 });
    expect(rows[1]).toMatchObject({ base: 200, kpi: 0 });
    expect(salaryBalance(rows)).toBe(4200);
  });
  it('handles no employees and no income', () => {
    expect(calculate({ employees: [], rates: [] })).toEqual({});
    expect(calculate({ monthlyProfit: [] }).one[0]).toMatchObject({ base: 1000, kpi: 0 });
  });
  it('adds every employee month together for the club-wide history', () => {
    const second = { ...employee, id: 'two' };
    const rows = calculate({ throughDate: '2026-10-02', employees: [employee, second], rates: [rate, { ...rate, id: 'r2', employee_id: 'two' }], entries: [entry('payment', 500)] });
    const combined = combineSalaryMonths(rows);
    expect(combined.map((month) => month.month)).toEqual(['2026-09', '2026-10']);
    expect(combined[0].base).toBe(rows.one[0].base + rows.two[0].base);
    expect(combined[0].paid).toBe(500);
    expect(salaryBalance(combined)).toBe(salaryBalance(rows.one) + salaryBalance(rows.two));
    expect(combineSalaryMonths({})).toEqual([]);
  });
  it('keeps future employees at zero without reducing current employees KPI', () => {
    const upcoming = { ...employee, id:'future', joined_on:'2026-10-01' };
    const futureRate = { ...rate, id:'future-rate', employee_id:'future', effective_date:'2026-10-01' };
    const rows = calculate({employees:[employee,upcoming],rates:[rate,futureRate]});
    expect(salaryBalance(rows.future)).toBe(0);
    expect(rows.one).toEqual(calculate().one);
    const started = calculate({employees:[upcoming], rates:[futureRate],throughDate:'2026-10-01',monthlyProfit:[]});
    expect(salaryBalance(started.future)).toBe(100);
  });

  it('supports KPI-only employees with zero daily or monthly base salary', () => {
    for (const salary_type of ['daily', 'monthly'] as const) {
      const row = calculate({ rates: [{ ...rate, salary_type, amount: 0 }], monthlyProfit: [profit(11000)] }).one[0];
      expect(row).toMatchObject({ base: 0, kpi: 1000, kpiProfit: 10000, earned: 1000, balance: 1000 });
    }
  });

  it('excludes deleted entries and rates without removing audit history', () => {
    const deleted_at = '2026-09-10T12:00:00Z';
    const rows = calculate({rates:[rate,{...rate,id:'deleted',effective_date:'2026-09-05',amount:9999,deleted_at}],entries:[{...entry('bonus',500),deleted_at},{...entry('fine',200),deleted_at},{...entry('payment',500),deleted_at}]});
    expect(rows).toEqual(calculate());
  });

});

it('keeps the final live rate available for editing, ignoring deleted history and other staff',()=>{
 expect(canDeleteSalaryRate([rate],rate)).toBe(false);
 expect(canDeleteSalaryRate([rate,{...rate,id:'deleted',deleted_at:'2026-09-24'},{...rate,id:'other',employee_id:'two'}],rate)).toBe(false);
 expect(canDeleteSalaryRate([rate,{...rate,id:'replacement'}],rate)).toBe(true);
});

describe('KPI basis and profit pools', () => {
  const mixed = { ...profit(12000), bar_earned: 6000, game_club_withdrawn: 4000, bar_withdrawn: 1000 };
  it('takes KPI from the ticked pool only', () => {
    const gameClub = calculate({ rates: [{ ...rate, kpi_game_club: true, kpi_bar: false }], monthlyProfit: [mixed] }).one[0];
    const bar = calculate({ rates: [{ ...rate, kpi_game_club: false, kpi_bar: true }], monthlyProfit: [mixed] }).one[0];
    const both = calculate({ monthlyProfit: [mixed] }).one[0];
    expect(gameClub).toMatchObject({ kpi: 1000, kpiProfit: 10000 });
    expect(bar).toMatchObject({ kpi: 454.55, kpiProfit: 4545.45 });
    expect(both.kpi).toBe(1545.45);
  });
  it('adds back only salary payments paid from the ticked pools', () => {
    const payment = { ...entry('payment', 500), payment_source: 'bar' };
    const gameClub = calculate({ rates: [{ ...rate, kpi_bar: false }], entries: [payment], monthlyProfit: [profit(12000)] }).one[0];
    expect(gameClub.kpi).toBe(1000);
  });
  it('does not deduct investment expenses from overall-profit KPI, only every other expense', () => {
    // 12000 earned already has 3000 of investments (game club) and 500 (bar) taken off.
    const invested = { ...mixed, game_club_investments: 3000, bar_investments: 500 };
    expect(calculate({ rates: [{ ...rate, kpi_bar: false }], monthlyProfit: [invested] }).one[0]).toMatchObject({ kpi: 1272.73, kpiProfit: 12727.27 });
    expect(calculate({ rates: [{ ...rate, kpi_game_club: false }], monthlyProfit: [invested] }).one[0]).toMatchObject({ kpi: 500, kpiProfit: 5000 });
    expect(calculate({ rates: [{ ...rate, kpi_basis: 'owner_profit' }], monthlyProfit: [invested] }).one[0].kpi).toBe(500);
    expect(applySalaryPaymentChanges([invested], [], [entry('payment', 500)])[0]).toMatchObject({ game_club_earned: 11500, game_club_investments: 3000 });
  });
  it('owner profit basis is a percentage of what the owner withdrew from the ticked pools', () => {
    const base = { ...rate, kpi_basis: 'owner_profit' as const };
    expect(calculate({ rates: [base], monthlyProfit: [mixed] }).one[0]).toMatchObject({ kpi: 500, kpiProfit: 5000 });
    expect(calculate({ rates: [{ ...base, kpi_bar: false }], monthlyProfit: [mixed] }).one[0].kpi).toBe(400);
    expect(calculate({ rates: [{ ...base, kpi_game_club: false }], monthlyProfit: [mixed] }).one[0].kpi).toBe(100);
    expect(calculate({ rates: [base], monthlyProfit: [profit(12000)] }).one[0].kpi).toBe(0);
  });
  it('keeps groups with different bases independent', () => {
    const second = { ...employee, id: 'two' };
    const rows = calculate({
      employees: [employee, second],
      rates: [rate, { ...rate, id: 'r2', employee_id: 'two', kpi_percent: 20, kpi_basis: 'owner_profit' }],
      monthlyProfit: [mixed],
    });
    expect(rows.one[0].kpi).toBe(1545.45);
    expect(rows.two[0].kpi).toBe(1000);
  });
});

describe('rate in force and employee status', () => {
  const rates: SalaryRate[] = [
    { ...rate, id: 'old', effective_date: '2026-09-01' },
    { ...rate, id: 'new', effective_date: '2026-09-20', active: false },
    { ...rate, id: 'gone', effective_date: '2026-09-15', deleted_at: '2026-09-16T00:00:00Z' },
    { ...rate, id: 'other', employee_id: 'two', effective_date: '2026-10-05' },
  ];
  it('picks the latest live rate effective on the date', () => {
    expect(rateInForce(rates, 'one', '2026-09-16')?.id).toBe('old');
    expect(rateInForce(rates, 'one', '2026-09-20')?.id).toBe('new');
    expect(rateInForce(rates, 'two', '2026-09-20')).toBeUndefined();
  });
  it('shows the first future rate for staff who have not started', () => {
    expect(displayedRate(rates, 'two', '2026-09-20')?.id).toBe('other');
    expect(displayedRate(rates, 'one', '2026-09-16')?.id).toBe('old');
    expect(displayedRate(rates, 'nobody', '2026-09-16')).toBeUndefined();
  });
  it('classifies upcoming, active and inactive employees', () => {
    const future = { ...employee, id: 'two', joined_on: '2026-10-05' };
    expect(employeeStatus(future, displayedRate(rates, 'two', '2026-09-20'), '2026-09-20')).toBe('upcoming');
    expect(employeeStatus(employee, displayedRate(rates, 'one', '2026-09-16'), '2026-09-16')).toBe('active');
    expect(employeeStatus(employee, displayedRate(rates, 'one', '2026-09-20'), '2026-09-20')).toBe('inactive');
    expect(employeeStatus(employee, undefined, '2026-09-20')).toBe('inactive');
  });
});

describe('applying salary payment changes to loaded profit', () => {
  const payment = (id: string, amount: number, source: 'game_club' | 'bar', date = '2026-09-10', deleted = false): SalaryEntry => ({
    ...entry('payment', amount, date), id, payment_source: source, deleted_at: deleted ? '2026-09-11T00:00:00Z' : null,
  });
  it('lowers earned cash for new payments and restores it for deleted ones', () => {
    const before = [payment('a', 300, 'bar')];
    const after = [payment('a', 300, 'bar', '2026-09-10', true), payment('b', 500, 'game_club'), { ...entry('bonus', 50), id: 'c' }];
    expect(applySalaryPaymentChanges([profit(12000)], before, after)).toEqual([{ ...profit(11500), bar_earned: 300 }]);
  });
  it('adds a month row when the payment month has none and keeps rows untouched without changes', () => {
    const rows = [profit(12000)];
    expect(applySalaryPaymentChanges(rows, [], [payment('a', 200, 'bar', '2026-10-02')])).toEqual([profit(12000), { ...profit(0, '2026-10'), bar_earned: -200 }]);
    expect(applySalaryPaymentChanges(rows, [payment('a', 1, 'bar')], [payment('a', 1, 'bar')])).toBe(rows);
  });
  it('keeps KPI identical to a full reload after a payment', () => {
    const loaded = calculate().one[0];
    const patched = calculate({ entries: [entry('payment', 500)], monthlyProfit: applySalaryPaymentChanges([profit(12000)], [], [entry('payment', 500)]) }).one[0];
    expect(patched.kpi).toBe(loaded.kpi);
    expect(patched.balance).toBe(loaded.balance - 500);
  });
});
