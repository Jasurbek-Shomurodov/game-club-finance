import { formatCurrency, formatDateShort } from '../formatters';
import { RUSSIAN_EXPENSE_CATEGORY_LABELS } from './expenseCategoryLabels';

export interface ExpenseNotificationInput {
  addedBy: string;
  amount: number;
  category: string;
  comment: string | null;
  date: string;
  paymentMethod: string;
  paymentSource: 'game_club' | 'bar';
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Наличные',
  terminal: 'Терминал',
  card: 'Карта',
};

export function buildExpenseNotification(input: ExpenseNotificationInput): string {
  const source = input.paymentSource === 'bar' ? 'Бар' : 'Игровой клуб';
  const method = PAYMENT_METHOD_LABELS[input.paymentMethod] ?? input.paymentMethod;
  const category = RUSSIAN_EXPENSE_CATEGORY_LABELS[input.category] ?? input.category;
  const lines = [
    '💸 Добавлен расход',
    '',
    `Сумма: ${formatCurrency(input.amount)} сум`,
    `Категория: ${category}`,
    `Источник: ${source}`,
    `Способ оплаты: ${method}`,
    `Дата: ${formatDateShort(input.date, 'ru')}`,
    `Добавил(а): ${input.addedBy}`,
  ];

  if (input.comment) lines.push(`Комментарий: ${input.comment}`);
  return lines.join('\n');
}
