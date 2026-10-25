import { formatCurrency, formatDateShort, formatUnitCurrency } from '../formatters';
import type { ExchangeMethod } from '../calculations/moneyExchanges';

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

const METHOD_LABELS: Record<ExchangeMethod, string> = {
  cash: 'Наличные',
  terminal: 'Терминал',
  card: 'Карта',
  usd: 'Доллары',
};

const amount = (method: ExchangeMethod, value: number) => (
  method === 'usd' ? `$${formatUnitCurrency(value)}` : `${formatCurrency(value)} сум`
);

export function buildExchangeNotification(input: ExchangeNotificationInput): string {
  const lines = [
    '🔄 Обмен денег',
    '',
    `Из: ${METHOD_LABELS[input.from]} — ${amount(input.from, input.fromAmount)}`,
    `В: ${METHOD_LABELS[input.to]} — ${amount(input.to, input.toAmount)}`,
  ];
  if (input.rate !== null) lines.push(`Курс: 1 $ = ${formatUnitCurrency(input.rate)} сум`);
  lines.push(`Дата: ${formatDateShort(input.date, 'ru')}`, `Добавил(а): ${input.addedBy}`);
  if (input.comment) lines.push(`Комментарий: ${input.comment}`);
  return lines.join('\n');
}
