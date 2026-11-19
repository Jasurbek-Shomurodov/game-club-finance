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
