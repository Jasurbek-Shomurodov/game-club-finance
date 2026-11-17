import { WRITE_OFF_KIND_LABELS } from './dailyFinanceReport';
import { authorLine, details, lines, noticeDate, sum } from './messageParts';

export interface StockWriteOffNoticeInput {
  /** YYYY-MM-DD: the stock-count day the write-off belongs to. */
  date: string;
  productName: string;
  /** The write-off as saved now; quantity 0 means it was removed. */
  kind: 'shortage' | 'expired' | null;
  quantity: number;
  /** quantity × the count's saved cost price; it comes off bar profit. */
  cost: number;
  note: string;
  by: string;
}

const units = (value: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} шт.`;
const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('ru') + text.slice(1);

/** A bar write-off was recorded, changed or removed on Closing Stock. */
export function buildStockWriteOffNotice(input: StockWriteOffNoticeInput): string {
  if (input.quantity <= 0 || !input.kind) {
    return lines(
      `↩️ Списание бара отменено: ${input.productName}`,
      details(noticeDate(input.date), 'товар вернулся в остаток'),
      input.by,
    );
  }
  return lines(
    `🗑 Списание бара: ${sum(input.cost)}`,
    details(input.productName, capitalize(WRITE_OFF_KIND_LABELS[input.kind]), units(input.quantity), noticeDate(input.date)),
    'Себестоимость списана с прибыли бара',
    authorLine(input.by, input.note.trim() || null),
  );
}
