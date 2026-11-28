/**
 * Collected money (migration 169): Game Club money a collector took out of the
 * admin's till. It sits apart from the till until it pays for something, goes
 * into the owner reserve, or the month ends (it stays that month's owner
 * profit). The till is a running balance across the month's days, so a bill
 * paid from three days of cash never reads as a negative day here.
 *
 *   till (still with the admin) = method money left - collected held
 *   collected held              = collected - paid from collected - moved to reserve
 *
 * Money left per method (Reports' cards) is unchanged: it is till + collected.
 */

export const COLLECTED_METHODS = ['cash', 'terminal', 'card', 'playstation'] as const;
export type CollectedMethod = (typeof COLLECTED_METHODS)[number];

export function isCollectedMethod(value: unknown): value is CollectedMethod {
  return typeof value === 'string' && (COLLECTED_METHODS as readonly string[]).includes(value);
}

/** One move of collected money, as get_collected_money_moves returns it. */
export interface CollectedMoneyMove {
  /** collect: taken from the till (positive). expense / reserve: paid out of collected money (negative). */
  kind: 'collect' | 'expense' | 'reserve';
  /** A collection's request id (its rows share it), an expense id, or a reserve entry id. */
  id: string;
  date: string;
  method: CollectedMethod;
  amount: number;
  comment: string | null;
  createdBy: string | null;
  createdAt: string;
}

export type ByCollectedMethod = Record<CollectedMethod, number> & { total: number };

export const NO_COLLECTED_MONEY: ByCollectedMethod = { cash: 0, terminal: 0, card: 0, playstation: 0, total: 0 };

/** One collect: every method a collector took in a single save. */
export interface CollectionGroup extends ByCollectedMethod {
  id: string;
  date: string;
  createdAt: string;
  createdBy: string | null;
  comment: string | null;
}

export interface CollectedMoneySummary {
  collected: ByCollectedMethod;
  /** Expenses paid from collected money (positive figures). */
  spent: ByCollectedMethod;
  /** Moved into the owner reserve (positive figures). */
  toReserve: ByCollectedMethod;
  /** Still with the collector: collected - spent - toReserve. */
  held: ByCollectedMethod;
  /** Newest first. */
  collections: CollectionGroup[];
}

function add(sum: ByCollectedMethod, method: CollectedMethod, amount: number): ByCollectedMethod {
  return { ...sum, [method]: sum[method] + amount, total: sum.total + amount };
}

export function summarizeCollectedMoney(moves: readonly CollectedMoneyMove[]): CollectedMoneySummary {
  let collected = NO_COLLECTED_MONEY;
  let spent = NO_COLLECTED_MONEY;
  let toReserve = NO_COLLECTED_MONEY;
  const groups = new Map<string, CollectionGroup>();
  for (const move of moves) {
    if (move.kind === 'collect') {
      collected = add(collected, move.method, move.amount);
      const group = groups.get(move.id) ?? {
        ...NO_COLLECTED_MONEY,
        id: move.id,
        date: move.date,
        createdAt: move.createdAt,
        createdBy: move.createdBy,
        comment: move.comment,
      };
      groups.set(move.id, { ...group, ...add(group, move.method, move.amount) });
    } else if (move.kind === 'expense') {
      spent = add(spent, move.method, -move.amount);
    } else {
      toReserve = add(toReserve, move.method, -move.amount);
    }
  }
  const held = COLLECTED_METHODS.reduce(
    (sum, method) => add(sum, method, collected[method] - spent[method] - toReserve[method]),
    NO_COLLECTED_MONEY,
  );
  const collections = [...groups.values()].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return { collected, spent, toReserve, held, collections };
}

/** What a method still has in the admin's till: its money left minus what collected money holds. */
export function moneyStillHeld(left: number, collectedHeld: number): number {
  return left - collectedHeld;
}

/**
 * What each method still has in the admin's till, and all of them together:
 * Reports' "With the admin" card. `left` is each method's money left for the
 * month so far (Reports' method cards), `collectedHeld` what collected money
 * still holds of it over the same days.
 */
export function moneyStillHeldByMethod(
  left: Readonly<Record<CollectedMethod, number>>,
  collectedHeld: ByCollectedMethod,
): ByCollectedMethod {
  return COLLECTED_METHODS.reduce(
    (sum, method) => add(sum, method, moneyStillHeld(left[method], collectedHeld[method])),
    NO_COLLECTED_MONEY,
  );
}

/** Where the money is: the three places of Reports' "Where the money is", and their sum. */
export interface MoneyWhereabouts {
  /** Still in the admin's till (Reports' "With the admin"). */
  kassa: number;
  /** Taken out by a collector and not yet spent or put into the reserve. */
  collected: number;
  /** The owner reserve's sums, both sides, without its dollars (155). */
  reserveSums: number;
  /** Dollars in the reserve's USD account (143); never converted into sums. */
  reserveUsd: number;
  /** kassa + collected + reserveSums; the dollars stay apart. */
  totalSums: number;
}

/** The till, collected money and the reserve as Reports shows them, with their total in sums. */
export function summarizeMoneyWhereabouts(input: {
  left: Readonly<Record<CollectedMethod, number>>;
  collectedMoves: readonly CollectedMoneyMove[];
  reserve: { sums: number; usd: number };
}): MoneyWhereabouts {
  const collected = summarizeCollectedMoney(input.collectedMoves).held;
  const kassa = moneyStillHeldByMethod(input.left, collected).total;
  return {
    kassa,
    collected: collected.total,
    reserveSums: input.reserve.sums,
    reserveUsd: input.reserve.usd,
    totalSums: kassa + collected.total + input.reserve.sums,
  };
}

/**
 * The days whose money the till and collected money hold today: the business
 * month's first day through today. Both start each month at zero, so a period
 * reaching back into an earlier month says nothing about where money is now.
 */
export function monthToDateRange(today: string): { from: string; to: string } {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/**
 * Whether a Reports period's own figures already are where the money is today.
 * Its method cards and collected money run from its month's first day through
 * its end, so a period that starts in today's month and reaches today has
 * counted every day so far (nothing is ever dated after the business today).
 */
export function periodCoversMoneyNow(range: { from: string; to: string }, today: string): boolean {
  return range.from.slice(0, 7) === today.slice(0, 7) && range.to >= today;
}

/** Whether a period is the current business month: its first day through today or later in the month. */
export function isCurrentMonthPeriod(range: { from: string; to: string }, today: string): boolean {
  const month = today.slice(0, 7);
  return range.from === `${month}-01` && range.to.slice(0, 7) === month && range.to >= today;
}

/** Moves from the RPC payload, or none when it is missing or malformed (before migration 169). */
export function parseCollectedMoneyMoves(value: unknown): CollectedMoneyMove[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): CollectedMoneyMove[] => {
    const row = raw as Record<string, unknown> | null;
    if (!row || (row.kind !== 'collect' && row.kind !== 'expense' && row.kind !== 'reserve')) return [];
    if (typeof row.id !== 'string' || typeof row.date !== 'string' || !isCollectedMethod(row.method)) return [];
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) return [];
    return [{
      kind: row.kind,
      id: row.id,
      date: row.date,
      method: row.method,
      amount,
      comment: typeof row.comment === 'string' ? row.comment : null,
      createdBy: typeof row.created_by === 'string' ? row.created_by : null,
      createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    }];
  });
}

/** What the till and collected money can give per method on a day, from get_collection_balances. */
export type CollectionBalances = Record<CollectedMethod, { till: number; collected: number }>;

export function parseCollectionBalances(value: unknown): CollectionBalances | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, { till?: unknown; collected?: unknown } | undefined>;
  const result = {} as CollectionBalances;
  for (const method of COLLECTED_METHODS) {
    const entry = row[method];
    result[method] = {
      till: Math.max(0, Number(entry?.till) || 0),
      collected: Math.max(0, Number(entry?.collected) || 0),
    };
  }
  return result;
}

/** One line of the collected money ledger: a collect (every method of one save), an expense, or a move to the reserve. */
export interface CollectedLedgerEntry extends ByCollectedMethod {
  kind: CollectedMoneyMove['kind'];
  id: string;
  date: string;
  createdAt: string;
  createdBy: string | null;
  comment: string | null;
  /** What collected money held, all methods together, once this line was saved. */
  heldAfter: number;
}

/**
 * Every move of collected money as ledger lines, newest first. Amounts are
 * signed (a collect adds, an expense or a reserve move takes away) and each
 * line carries the running balance, which ends at the summary's held total.
 */
export function buildCollectedLedger(moves: readonly CollectedMoneyMove[]): CollectedLedgerEntry[] {
  const lines = new Map<string, CollectedLedgerEntry>();
  for (const move of moves) {
    const key = `${move.kind}:${move.id}`;
    const line = lines.get(key) ?? {
      ...NO_COLLECTED_MONEY,
      kind: move.kind,
      id: move.id,
      date: move.date,
      createdAt: move.createdAt,
      createdBy: move.createdBy,
      comment: move.comment,
      heldAfter: 0,
    };
    lines.set(key, { ...line, ...add(line, move.method, move.amount) });
  }
  const oldestFirst = [...lines.values()].sort((a, b) => (
    a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  ));
  let held = 0;
  return oldestFirst.map((line) => {
    held += line.total;
    return { ...line, heldAfter: held };
  }).reverse();
}

/** What one person collected over the period. */
export interface CollectorTotal extends ByCollectedMethod {
  /** The collector's user id, or null when it is not known. */
  collectorId: string | null;
  count: number;
  lastDate: string;
}

/** Collections summed per collector, the largest total first. */
export function summarizeByCollector(collections: readonly CollectionGroup[]): CollectorTotal[] {
  const byCollector = new Map<string | null, CollectorTotal>();
  for (const group of collections) {
    const current = byCollector.get(group.createdBy) ?? {
      ...NO_COLLECTED_MONEY,
      collectorId: group.createdBy,
      count: 0,
      lastDate: group.date,
    };
    const next = COLLECTED_METHODS.reduce((sum, method) => add(sum, method, group[method]), current as ByCollectedMethod);
    byCollector.set(group.createdBy, {
      ...current,
      ...next,
      count: current.count + 1,
      lastDate: group.date > current.lastDate ? group.date : current.lastDate,
    });
  }
  return [...byCollector.values()].sort((a, b) => b.total - a.total || b.lastDate.localeCompare(a.lastDate));
}

/** Per-method and total sums of some ledger lines or collections, e.g. the ones a filter leaves. */
export function sumCollectedRows(rows: ReadonlyArray<ByCollectedMethod>): ByCollectedMethod {
  return rows.reduce(
    (sum, row) => COLLECTED_METHODS.reduce((acc, method) => add(acc, method, row[method]), sum),
    NO_COLLECTED_MONEY,
  );
}
