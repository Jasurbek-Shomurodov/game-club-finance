import { formatCurrency, formatDateShort } from '../formatters';
import type { CashShortageMethod, CashShortageReason, OwnerWithdrawalSource } from '@/types';

export interface CashShortageNotificationInput {
  addedBy: string;
  date: string;
  source: OwnerWithdrawalSource;
  method: CashShortageMethod;
  amount: number;
  reason: CashShortageReason;
  employee: string | null;
  recovered: number;
  comment: string;
}

const SOURCE_LABELS: Record<OwnerWithdrawalSource, string> = { game_club: 'Игровой клуб', bar: 'Бар' };
const METHOD_LABELS: Record<CashShortageMethod, string> = {
  cash: 'Наличные', terminal: 'Терминал', card: 'Карта', playstation: 'PlayStation',
};
const REASON_LABELS: Record<CashShortageReason, string> = {
  stolen: 'Украдено', short_handover: 'Сдано не полностью', unknown: 'Неизвестно',
};

/** Owners-only group message for a new cash shortage (Russian, like every club-group message). */
export function buildCashShortageNotification(input: CashShortageNotificationInput): string {
  const lines = [
    '⚠️ Недостача',
    '',
    `Сумма: ${formatCurrency(input.amount)} сум`,
    `Откуда: ${SOURCE_LABELS[input.source]} · ${METHOD_LABELS[input.method]}`,
    `Причина: ${REASON_LABELS[input.reason]}`,
    `Ответственный: ${input.employee ?? 'неизвестно'}`,
  ];
  if (input.recovered > 0) {
    lines.push(
      `Удержано из зарплаты: ${formatCurrency(input.recovered)} сум`,
      `Потеряно: ${formatCurrency(Math.max(0, input.amount - input.recovered))} сум`,
    );
  }
  lines.push(`Дата: ${formatDateShort(input.date, 'ru')}`, `Добавил(а): ${input.addedBy}`, `Комментарий: ${input.comment}`);
  return lines.join('\n');
}
