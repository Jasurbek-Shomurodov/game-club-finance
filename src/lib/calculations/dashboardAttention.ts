import type { TrendRow } from './dashboardMetrics';

export interface DashboardDebtor {
  /** The name as first written; debts are grouped ignoring case and spacing. */
  name: string;
  remaining: number;
  /** Unpaid or partly paid debts of this person. */
  count: number;
  /** Date of the oldest of them. */
  oldestDate: string;
}

interface OpenDebtRow {
  person_name?: string | null;
  date: string;
  remaining_amount: number | string | null;
  status: string;
}

const debtorKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');

/**
 * Who still owes the club, largest balance first. A person with several open
 * debts appears once. Debts without a name are grouped under an empty name.
 */
export function summarizeDebtors(debts: ReadonlyArray<OpenDebtRow>): DashboardDebtor[] {
  const byPerson = new Map<string, DashboardDebtor>();
  for (const debt of debts) {
    const remaining = Number(debt.remaining_amount ?? 0) || 0;
    if (debt.status === 'paid' || remaining <= 0) continue;
    const name = (debt.person_name ?? '').trim().replace(/\s+/g, ' ');
    const key = debtorKey(name);
    const debtor = byPerson.get(key);
    if (debtor) {
      debtor.remaining += remaining;
      debtor.count += 1;
      if (debt.date < debtor.oldestDate) debtor.oldestDate = debt.date;
    } else {
      byPerson.set(key, { name, remaining, count: 1, oldestDate: debt.date });
    }
  }
  return [...byPerson.values()].sort((a, b) => (
    b.remaining - a.remaining || a.oldestDate.localeCompare(b.oldestDate) || a.name.localeCompare(b.name, 'ru')
  ));
}

export interface DashboardTodayStatus {
  /** The business date has a daily cash entry. */
  cashEntered: boolean;
  /** The business date has a saved closing stock count. */
  stockSaved: boolean;
  /** Game Club income entered for the business date, new debts included. */
  gameClubIncome: number;
  barSales: number;
  /** Earlier dates of the period with no cash entry, oldest first. */
  missingCashDates: string[];
  /** Earlier dates of the period with no closing stock count, oldest first. */
  missingStockDates: string[];
}

export const emptyDashboardTodayStatus: DashboardTodayStatus = {
  cashEntered: false,
  stockSaved: false,
  gameClubIncome: 0,
  barSales: 0,
  missingCashDates: [],
  missingStockDates: [],
};

/**
 * Days between the period's first entry of a ledger and yesterday that have
 * none. Days before the first entry are not gaps: the club may have opened,
 * or started keeping this ledger, in the middle of the period.
 */
function gapsBeforeToday(trendDates: string[], entered: ReadonlySet<string>, businessToday: string): string[] {
  const earlier = trendDates.filter((date) => date < businessToday);
  const first = earlier.find((date) => entered.has(date));
  if (!first) return [];
  return earlier.filter((date) => date > first && !entered.has(date));
}

/**
 * What the dashboard says about the current business date: whether the two
 * daily tasks are done, what was entered, and which earlier days were skipped.
 * `trend` is the period's day-by-day series; the entry dates say which days
 * have a saved row (a saved day may legitimately total zero).
 */
export function buildDashboardTodayStatus({
  trend,
  cashEntryDates,
  stockEntryDates,
  businessToday,
}: {
  trend: ReadonlyArray<TrendRow>;
  cashEntryDates: ReadonlyArray<string>;
  stockEntryDates: ReadonlyArray<string>;
  businessToday: string;
}): DashboardTodayStatus {
  const cash = new Set(cashEntryDates);
  const stock = new Set(stockEntryDates);
  const dates = trend.map((row) => row.date);
  const today = trend.find((row) => row.date === businessToday);
  return {
    cashEntered: cash.has(businessToday),
    stockSaved: stock.has(businessToday),
    gameClubIncome: today?.gameClubIncome ?? 0,
    barSales: today?.barSales ?? 0,
    missingCashDates: gapsBeforeToday(dates, cash, businessToday),
    missingStockDates: gapsBeforeToday(dates, stock, businessToday),
  };
}
