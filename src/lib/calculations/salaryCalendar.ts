import type { SalaryEntry } from './salaries';

export type SalaryEntryKind = SalaryEntry['kind'];

export interface SalaryCalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  /** Live (not deleted) amounts per kind; a kind with nothing that day is absent. */
  totals: Partial<Record<SalaryEntryKind, number>>;
  /** Every entry on the day, deleted ones included, so the day still opens its history. */
  count: number;
}

/** YYYY-MM shifted by whole months. */
export function shiftYearMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const index = year * 12 + monthNumber - 1 + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * The Monday-first weeks covering `month` (YYYY-MM), each day carrying the
 * payments, bonuses and fines recorded on it.
 */
export function buildSalaryCalendar(month: string, entries: SalaryEntry[], today: string): SalaryCalendarDay[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const monthDays = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const byDate = new Map<string, SalaryEntry[]>();
  for (const entry of entries) byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);

  return Array.from({ length: Math.ceil((mondayOffset + monthDays) / 7) * 7 }, (_, index) => {
    const cursor = new Date(Date.UTC(year, monthNumber - 1, 1 - mondayOffset + index));
    const date = cursor.toISOString().slice(0, 10);
    const dayEntries = byDate.get(date) ?? [];
    const totals: SalaryCalendarDay['totals'] = {};
    for (const entry of dayEntries) {
      if (!entry.deleted_at) totals[entry.kind] = (totals[entry.kind] ?? 0) + Number(entry.amount);
    }
    return { date, day: cursor.getUTCDate(), inMonth: date.startsWith(month), isToday: date === today, totals, count: dayEntries.length };
  });
}
