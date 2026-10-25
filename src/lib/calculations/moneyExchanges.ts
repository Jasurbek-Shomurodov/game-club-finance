/**
 * Money exchanges (migration 092) move Game Club money between payment methods
 * or into and out of US dollars. They are neither income nor expenses: the
 * "from" method loses `from_amount` and the "to" method gains `to_amount`.
 * Dollars are a separate holding and are never added to UZS totals.
 */

import { PAYMENT_METHODS } from '@/types';
import type { MoneyLeftByPaymentMethod } from './dashboardMetrics';

/** The club payment methods plus US dollars, which are held apart from UZS. */
export const EXCHANGE_METHODS = [...PAYMENT_METHODS, 'usd'] as const;
export type ExchangeMethod = (typeof EXCHANGE_METHODS)[number];

export interface MoneyExchangeRow {
  id: string;
  date: string;
  from_method: ExchangeMethod;
  to_method: ExchangeMethod;
  from_amount: number | string;
  to_amount: number | string;
  /** UZS per one US dollar; null for exchanges between UZS methods. */
  rate: number | string | null;
  comment?: string | null;
  created_by?: string | null;
  created_at?: string;
  creator_name?: string | null;
}

export type ExchangeNetByMethod = Record<ExchangeMethod, number>;

export function isExchangeMethod(value: unknown): value is ExchangeMethod {
  return typeof value === 'string' && (EXCHANGE_METHODS as readonly string[]).includes(value);
}

/** True when the exchange converts into or out of dollars and so needs a rate. */
export function exchangeNeedsRate(from: ExchangeMethod, to: ExchangeMethod): boolean {
  return from === 'usd' || to === 'usd';
}

/**
 * Amount received, mirroring `record_money_exchange`: UZS to dollars keeps
 * cents, dollars to UZS rounds to whole sums, UZS to UZS is unchanged.
 * Returns null when the inputs cannot form an exchange.
 */
export function exchangeReceivedAmount(
  from: ExchangeMethod,
  to: ExchangeMethod,
  amount: number,
  rate: number | null,
): number | null {
  if (from === to || !Number.isFinite(amount) || amount <= 0) return null;
  if (!exchangeNeedsRate(from, to)) return amount;
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;
  const received = to === 'usd' ? Math.round((amount / rate) * 100) / 100 : Math.round(amount * rate);
  return received > 0 ? received : null;
}

/** Net change per method: what was exchanged in minus what was exchanged out. */
export function exchangeNetByMethod(rows: MoneyExchangeRow[]): ExchangeNetByMethod {
  const net: ExchangeNetByMethod = { cash: 0, terminal: 0, card: 0, usd: 0 };
  for (const row of rows) {
    net[row.from_method] -= Number(row.from_amount ?? 0);
    net[row.to_method] += Number(row.to_amount ?? 0);
  }
  // Dollar cents can drift in floating point; UZS sums are whole.
  net.usd = Math.round(net.usd * 100) / 100;
  return net;
}

/**
 * Adds each month's exchanges (keyed `YYYY-MM`) to per-method balances that
 * were computed without them, such as the 050 owner profit snapshot. A month
 * with exchanges only gets a fresh entry.
 */
export function withExchangesByMonth(
  balancesByMonth: Record<string, MoneyLeftByPaymentMethod>,
  exchangeRows: MoneyExchangeRow[],
): Record<string, MoneyLeftByPaymentMethod> {
  const rowsByMonth = new Map<string, MoneyExchangeRow[]>();
  for (const row of exchangeRows) {
    const month = row.date.slice(0, 7);
    rowsByMonth.set(month, [...(rowsByMonth.get(month) ?? []), row]);
  }
  const result = { ...balancesByMonth };
  for (const [month, rows] of rowsByMonth) {
    const net = exchangeNetByMethod(rows);
    const balances = result[month] ?? { cash: 0, terminal: 0, card: 0, playstation: 0 };
    result[month] = {
      ...balances,
      cash: balances.cash + net.cash,
      terminal: balances.terminal + net.terminal,
      card: balances.card + net.card,
    };
  }
  return result;
}
