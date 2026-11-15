import { formatCurrency } from '../formatters';
import type { CashShortageMethod, CashShortageReason, OwnerWithdrawalSource } from '@/types';
import { authorLine, details, lines, method, noticeDate, source, sum } from './messageParts';

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

const REASON_LABELS: Record<CashShortageReason, string> = {
  stolen: 'Украдено', short_handover: 'Сдано не полностью', unknown: 'Причина неизвестна',
};

/** Owners-only group message for a new cash shortage (Russian, like every club-group message). */
export function buildCashShortageNotification(input: CashShortageNotificationInput): string {
  return lines(
    `⚠️ Недостача: ${sum(input.amount)}`,
    details(source(input.source), method(input.method), noticeDate(input.date)),
    details(REASON_LABELS[input.reason], input.employee ? `ответственный: ${input.employee}` : 'ответственный неизвестен'),
    input.recovered > 0 && details(
      `Удержано из зарплаты ${formatCurrency(input.recovered)}`,
      `потеряно ${sum(Math.max(0, input.amount - input.recovered))}`,
    ),
    authorLine(input.addedBy, input.comment),
  );
}
