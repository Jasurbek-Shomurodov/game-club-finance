import { formatCurrency, formatDateShort, formatUnitCurrency } from '../formatters';
import { RUSSIAN_EXPENSE_CATEGORY_LABELS } from './expenseCategoryLabels';

export interface ExpenseNotificationInput {
  addedBy: string;
  amount: number;
  category: string;
  comment: string | null;
  date: string;
  paymentMethod: string;
  paymentSource: 'game_club' | 'bar';
  /** Dollars spent and their rate, on an expense paid from the club's dollars (124). */
  dollars?: { amount: number; rate: number } | null;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Наличные',
  terminal: 'Терминал',
  card: 'Карта',
  playstation: 'PlayStation',
  usd: 'Доллары США',
};

export function buildExpenseNotification(input: ExpenseNotificationInput): string {
  const source = input.paymentSource === 'bar' ? 'Бар' : 'Игровой клуб';
  const method = PAYMENT_METHOD_LABELS[input.paymentMethod] ?? input.paymentMethod;
  const category = RUSSIAN_EXPENSE_CATEGORY_LABELS[input.category] ?? input.category;
  const dollars = input.dollars
    ? ` ($${formatUnitCurrency(input.dollars.amount)} по курсу ${formatUnitCurrency(input.dollars.rate)})`
    : '';
  const lines = [
    '💸 Добавлен расход',
    '',
    `Сумма: ${formatCurrency(input.amount)} сум${dollars}`,
    `Категория: ${category}`,
    `Источник: ${source}`,
    `Способ оплаты: ${method}`,
    `Дата: ${formatDateShort(input.date, 'ru')}`,
    `Добавил(а): ${input.addedBy}`,
  ];

  if (input.comment) lines.push(`Комментарий: ${input.comment}`);
  return lines.join('\n');
}
