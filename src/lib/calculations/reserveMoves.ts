/**
 * The owner reserve (jamg'arma) kept out of a side's money left (156).
 *
 * The reserve is the owner's own money, apart from Game Club and Bar money:
 * money put into it (a deposit, or sums exchanged into dollars) leaves the
 * side it came from, money returned from it comes back, and a purchase it paid
 * (paid_from_reserve, or any dollar expense) never takes money out of a side.
 * Purchases stay expenses in totals and accounting profit; only "money left"
 * changes. This matches expense_method_balance and the Owner Profit page.
 */

/** One move into (positive amount) or out of (negative) the reserve, as get_reserve_moves returns it. */
export interface ReserveMove {
  /** YYYY-MM-DD the money moved, inside the profit month it belongs to. */
  date: string;
  source: 'game_club' | 'bar';
  /** Game Club: cash, terminal, card, playstation, or usd for a dollar exchange. Bar: null. */
  method: string | null;
  amount: number;
}

/** A purchase the reserve paid: its sums (136, stored as cash since 155) or its dollars (143). */
export function isReservePaidExpense(row: { paid_from_reserve?: boolean | null; payment_method?: string | null }): boolean {
  return row.paid_from_reserve === true || row.payment_method === 'usd';
}

/** Net money one side put into the reserve; `method` narrows the Game Club side to one payment method. */
export function reservedNetBy(
  moves: readonly ReserveMove[],
  source: ReserveMove['source'],
  method?: string,
): number {
  return moves.reduce((sum, move) => (
    move.source === source && (method === undefined || move.method === method) ? sum + Number(move.amount) : sum
  ), 0);
}

/** Moves from the RPC payload, or none when it is missing or malformed (before migration 156). */
export function parseReserveMoves(value: unknown): ReserveMove[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): ReserveMove[] => {
    const row = raw as Record<string, unknown> | null;
    if (!row || typeof row.date !== 'string' || (row.source !== 'game_club' && row.source !== 'bar')) return [];
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) return [];
    return [{ date: row.date, source: row.source, method: typeof row.method === 'string' ? row.method : null, amount }];
  });
}

