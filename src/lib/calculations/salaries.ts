import { differenceInCalendarDays, eachMonthOfInterval, format, parseISO } from 'date-fns';
import { monthRange } from '../utils';
import type { OwnerProfitMonthlyBalanceRow } from '@/lib/calculations/ownerProfitSnapshot';

export interface SalaryEmployee {
  id: string;
  club_id: string;
  name: string;
  job_title: string;
  joined_on: string;
}

/**
 * `overall_profit`: profit earned every day (Owner Profit "earned" cash, before withdrawals).
 * `owner_profit`: only money the owner has actually withdrawn.
 */
export type KpiBasis = 'owner_profit' | 'overall_profit';

export const DEFAULT_KPI_BASIS: KpiBasis = 'overall_profit';

export interface SalaryRate {
  deleted_at?: string | null;
  deleted_by?: string | null;
  delete_reason?: string | null;
  id: string;
  employee_id: string;
  effective_date: string;
  salary_type: 'daily' | 'monthly';
  amount: number;
  kpi_percent: number;
  /** Which profit the KPI percentage is taken from; absent on rates saved before migration 070. */
  kpi_basis?: KpiBasis;
  kpi_game_club?: boolean;
  kpi_bar?: boolean;
  active: boolean;
}

export interface SalaryEntry {
  deleted_at?: string | null;
  deleted_by?: string | null;
  delete_reason?: string | null;
  id: string;
  employee_id: string;
  date: string;
  kind: 'payment' | 'bonus' | 'fine';
  amount: number;
  comment: string;
  payment_method: string | null;
  payment_source: string | null;
  created_at: string;
}

export interface SalaryMonth {
  month: string;
  base: number;
  bonus: number;
  fine: number;
  kpi: number;
  paid: number;
  earned: number;
  balance: number;
  kpiProfit: number;
  effectiveKpiPercent: number;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Each salary rate chooses a KPI basis and the profit pools (Game Club, Bar) it
 * is taken from. Employees sharing a basis + pools form a group:
 *  - overall_profit: earned cash of the ticked pools before withdrawals, plus
 *    linked salary payments paid from those pools, minus the group's fixed pay
 *    (base + bonus - fine): residual = max(0, profit - fixed) / (1 + sum(shares)).
 *    Payment timing therefore cannot change KPI or deduct salary twice.
 *  - owner_profit: the amount the owner withdrew from the ticked pools in the
 *    month; KPI is the percentage of that amount.
 * Groups are independent: overlapping pools are not netted against each other.
 * Current/historical months remain estimates when underlying finance is edited.
 */
export function calculateSalaries({ employees, rates, entries, monthlyProfit, throughDate }: {
  employees: SalaryEmployee[];
  rates: SalaryRate[];
  entries: SalaryEntry[];
  monthlyProfit: OwnerProfitMonthlyBalanceRow[];
  throughDate: string;
}): Record<string, SalaryMonth[]> {
  const result: Record<string, SalaryMonth[]> = Object.fromEntries(employees.map((e) => [e.id, []]));
  const firstDate = employees.reduce((date, e) => e.joined_on < date ? e.joined_on : date, throughDate);
  const profits = new Map(monthlyProfit.map((row) => [row.period_month.slice(0, 7), row]));
  const employeeRates = new Map(employees.map((e) => [e.id, rates.filter((r) => !r.deleted_at && r.employee_id === e.id).sort((a, b) => a.effective_date.localeCompare(b.effective_date))]));
  for (const date of eachMonthOfInterval({ start: parseISO(firstDate), end: parseISO(throughDate) })) {
    const month = format(date, 'yyyy-MM');
    const { from, to } = monthRange(month);
    const end = to < throughDate ? to : throughDate;
    const daysInMonth = differenceInCalendarDays(parseISO(to), parseISO(from)) + 1;
    const elapsedDays = differenceInCalendarDays(parseISO(end), parseISO(from)) + 1;
    const monthEntries = entries.filter((e) => !e.deleted_at && e.date >= from && e.date <= end);
    const rows = employees.map((employee) => {
      let base = 0;
      let weightedPercent = 0;
      let activeDays = 0;
      const configs = new Map<string, { basis: KpiBasis; gameClub: boolean; bar: boolean; share: number; days: number }>();
      const terms = employeeRates.get(employee.id) ?? [];
      terms.forEach((rate, index) => {
        if (!rate.active) return;
        const start = [from, employee.joined_on, rate.effective_date].sort().at(-1)!;
        const next = terms[index + 1]?.effective_date;
        const inclusiveDays = differenceInCalendarDays(parseISO(end), parseISO(start)) + 1;
        const days = Math.max(0, next ? Math.min(inclusiveDays, differenceInCalendarDays(parseISO(next), parseISO(start))) : inclusiveDays);
        base += Number(rate.amount) * days / (rate.salary_type === 'monthly' ? daysInMonth : 1);
        const share = Number(rate.kpi_percent) * days / elapsedDays;
        weightedPercent += share;
        activeDays += days;
        const basis = rate.kpi_basis ?? DEFAULT_KPI_BASIS;
        const gameClub = rate.kpi_game_club ?? true;
        const bar = rate.kpi_bar ?? true;
        const key = `${basis}:${gameClub ? 1 : 0}${bar ? 1 : 0}`;
        const config = configs.get(key) ?? { basis, gameClub, bar, share: 0, days: 0 };
        config.share += share;
        config.days += days;
        configs.set(key, config);
      });
      const employeeEntries = monthEntries.filter((e) => e.employee_id === employee.id);
      const sum = (kind: SalaryEntry['kind']) => money(employeeEntries.filter((e) => e.kind === kind).reduce((s, e) => s + Number(e.amount), 0));
      const bonus = sum('bonus');
      const fine = sum('fine');
      return { employee, base: money(base), bonus, fine, paid: sum('payment'), weightedPercent, activeDays, configs, fixed: money(base) + bonus - fine };
    });

    const profitRow = profits.get(month);
    const paidFrom = (source: string) => monthEntries.filter((e) => e.kind === 'payment' && e.payment_source === source).reduce((s, e) => s + Number(e.amount), 0);
    const groups = new Map<string, { basis: KpiBasis; gameClub: boolean; bar: boolean; share: number; fixed: number; base: number }>();
    for (const row of rows) {
      for (const [key, config] of row.configs) {
        const group = groups.get(key) ?? { basis: config.basis, gameClub: config.gameClub, bar: config.bar, share: 0, fixed: 0, base: 0 };
        group.share += config.share / 100;
        group.fixed += row.activeDays ? row.fixed * config.days / row.activeDays : 0;
        groups.set(key, group);
      }
    }
    for (const group of groups.values()) {
      if (group.basis === 'owner_profit') {
        group.base = (group.gameClub ? Number(profitRow?.game_club_withdrawn ?? 0) : 0) + (group.bar ? Number(profitRow?.bar_withdrawn ?? 0) : 0);
        continue;
      }
      const beforePayroll = (group.gameClub ? Number(profitRow?.game_club_earned ?? 0) + paidFrom('game_club') : 0)
        + (group.bar ? Number(profitRow?.bar_earned ?? 0) + paidFrom('bar') : 0);
      group.base = Math.max(0, beforePayroll - group.fixed) / (1 + group.share);
    }

    for (const row of rows) {
      if (row.employee.joined_on > end) continue;
      let kpi = 0;
      let primaryBase = 0;
      let primaryShare = -1;
      for (const [key, config] of row.configs) {
        const base = groups.get(key)?.base ?? 0;
        kpi += base * config.share / 100;
        if (config.share > primaryShare) { primaryShare = config.share; primaryBase = base; }
      }
      kpi = money(kpi);
      const earned = money(row.base + row.bonus - row.fine + kpi);
      result[row.employee.id].push({ month, base: row.base, bonus: row.bonus, fine: row.fine, paid: row.paid, kpi, earned, balance: money(earned - row.paid), kpiProfit: money(primaryBase), effectiveKpiPercent: row.weightedPercent });
    }
  }
  return result;
}

export function salaryBalance(months: SalaryMonth[]): number {
  return money(months.reduce((sum, month) => sum + month.balance, 0));
}

/**
 * Every employee's months added together, oldest first, for the club-wide
 * history. KPI profit and percentage are per-employee figures, so they are 0.
 */
export function combineSalaryMonths(byEmployee: Record<string, SalaryMonth[]>): SalaryMonth[] {
  const totals = new Map<string, SalaryMonth>();
  for (const months of Object.values(byEmployee)) {
    for (const row of months) {
      const total = totals.get(row.month) ?? { month: row.month, base: 0, bonus: 0, fine: 0, kpi: 0, paid: 0, earned: 0, balance: 0, kpiProfit: 0, effectiveKpiPercent: 0 };
      total.base = money(total.base + row.base);
      total.bonus = money(total.bonus + row.bonus);
      total.fine = money(total.fine + row.fine);
      total.kpi = money(total.kpi + row.kpi);
      total.paid = money(total.paid + row.paid);
      total.earned = money(total.earned + row.earned);
      total.balance = money(total.balance + row.balance);
      totals.set(row.month, total);
    }
  }
  return [...totals.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Keep an editable baseline; deleted audit rows do not count as a live rate. */
export function canDeleteSalaryRate(rates: SalaryRate[], rate: SalaryRate): boolean {
  return !rate.deleted_at && rates.some((other) => other.employee_id === rate.employee_id && other.id !== rate.id && !other.deleted_at);
}

const liveRatesFor = (rates: SalaryRate[], employeeId: string) => rates.filter((r) => !r.deleted_at && r.employee_id === employeeId);

/** The live rate in force on `date`: the latest one effective on or before it. */
export function rateInForce(rates: SalaryRate[], employeeId: string, date: string): SalaryRate | undefined {
  let current: SalaryRate | undefined;
  for (const rate of liveRatesFor(rates, employeeId)) {
    if (rate.effective_date <= date && (!current || rate.effective_date > current.effective_date)) current = rate;
  }
  return current;
}

/** Rate to show for an employee: the one in force, or the first future one for staff who have not started yet. */
export function displayedRate(rates: SalaryRate[], employeeId: string, date: string): SalaryRate | undefined {
  const current = rateInForce(rates, employeeId, date);
  if (current) return current;
  let first: SalaryRate | undefined;
  for (const rate of liveRatesFor(rates, employeeId)) {
    if (!first || rate.effective_date < first.effective_date) first = rate;
  }
  return first;
}

export type SalaryEmployeeStatus = 'upcoming' | 'active' | 'inactive';

/** Upcoming staff join after `date` with active terms; otherwise the displayed rate decides. */
export function employeeStatus(employee: SalaryEmployee, rate: SalaryRate | undefined, date: string): SalaryEmployeeStatus {
  if (!rate?.active) return 'inactive';
  return employee.joined_on > date ? 'upcoming' : 'active';
}

/**
 * Every live salary payment also writes a salary expense, which lowers the
 * earned cash of its source in its month. After a payment is recorded or
 * deleted, apply that same change to already loaded monthly profit rows instead
 * of reloading the whole profit snapshot. Other finance edits still need a reload.
 */
export function applySalaryPaymentChanges(
  monthlyProfit: OwnerProfitMonthlyBalanceRow[],
  previousEntries: SalaryEntry[],
  nextEntries: SalaryEntry[],
): OwnerProfitMonthlyBalanceRow[] {
  const livePayments = (entries: SalaryEntry[]) => new Map(entries
    .filter((e) => !e.deleted_at && e.kind === 'payment' && (e.payment_source === 'game_club' || e.payment_source === 'bar'))
    .map((e) => [e.id, e]));
  const before = livePayments(previousEntries);
  const after = livePayments(nextEntries);
  const deltas = new Map<string, { game_club: number; bar: number }>();
  const add = (entry: SalaryEntry, sign: 1 | -1) => {
    const month = entry.date.slice(0, 7);
    const delta = deltas.get(month) ?? { game_club: 0, bar: 0 };
    delta[entry.payment_source as 'game_club' | 'bar'] += sign * Number(entry.amount);
    deltas.set(month, delta);
  };
  for (const [id, entry] of after) if (!before.has(id)) add(entry, -1);
  for (const [id, entry] of before) if (!after.has(id)) add(entry, 1);
  if (deltas.size === 0) return monthlyProfit;

  const rows = monthlyProfit.map((row) => {
    const delta = deltas.get(row.period_month.slice(0, 7));
    if (!delta) return row;
    deltas.delete(row.period_month.slice(0, 7));
    return {
      ...row,
      game_club_earned: money(Number(row.game_club_earned) + delta.game_club),
      bar_earned: money(Number(row.bar_earned) + delta.bar),
    };
  });
  for (const [month, delta] of deltas) {
    rows.push({ period_month: `${month}-01`, game_club_earned: money(delta.game_club), bar_earned: money(delta.bar), game_club_withdrawn: 0, bar_withdrawn: 0 });
  }
  return rows;
}
