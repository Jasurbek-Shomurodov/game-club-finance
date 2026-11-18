import { formatCurrency, formatUnitCurrency } from '../formatters';
import type { ExchangeMethod } from '../calculations/moneyExchanges';
import { authorLine, details, lines, noticeDate } from './messageParts';

export interface ExchangeNotificationInput {
  addedBy: string;
  date: string;
  from: ExchangeMethod;
  to: ExchangeMethod;
  fromAmount: number;
  toAmount: number;
  rate: number | null;
  comment: string | null;
}

export const EXCHANGE_METHOD_LABELS: Record<ExchangeMethod, string> = {
  cash: 'Наличные',
  terminal: 'Терминал',
  card: 'Карта',
  usd: 'Доллары',
};

export const exchangeAmount = (method: ExchangeMethod, value: number) => (
  method === 'usd' ? `$${formatUnitCurrency(value)}` : `${formatCurrency(value)} сум`
);

/** "1 285 000 сум → $100" */
export const exchangeAmounts = (from: ExchangeMethod, fromAmount: number, to: ExchangeMethod, toAmount: number) => (
  `${exchangeAmount(from, fromAmount)} → ${exchangeAmount(to, toAmount)}`
);

/** "Наличные → Доллары" */
export const exchangeMethods = (from: ExchangeMethod, to: ExchangeMethod) => (
  `${EXCHANGE_METHOD_LABELS[from]} → ${EXCHANGE_METHOD_LABELS[to]}`
);

/** Dollars are the owner reserve's (143): buying them puts money in, selling them takes it out. */
export const exchangeReserveNote = (from: ExchangeMethod, to: ExchangeMethod) => (
  to === 'usd' ? 'доллары в резерв' : from === 'usd' ? 'доллары из резерва' : null
);

export function buildExchangeNotification(input: ExchangeNotificationInput): string {
  const reserve = exchangeReserveNote(input.from, input.to);
  return lines(
    `${reserve ? '🏦' : '🔄'} Обмен: ${exchangeAmounts(input.from, input.fromAmount, input.to, input.toAmount)}`,
    details(
      exchangeMethods(input.from, input.to),
      reserve,
      input.rate !== null && `курс ${formatUnitCurrency(input.rate)}`,
      noticeDate(input.date),
    ),
    authorLine(input.addedBy, input.comment),
  );
}
