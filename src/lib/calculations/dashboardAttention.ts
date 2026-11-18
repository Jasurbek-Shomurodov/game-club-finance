
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
