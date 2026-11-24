import { formatCurrency, formatDateShort, formatUnitCurrency } from '../formatters';

/**
 * Shared pieces of the Russian club-group messages. Every message follows one
 * shape: line 1 says what happened and how much; line 2 holds the details,
 * always including the date; the last line names who did it, followed by the
 * entry's comment like a chat line.
 */

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Наличные',
  terminal: 'Терминал',
  card: 'Карта',
  playstation: 'PlayStation',
  usd: 'Доллары США',
};

export const SOURCE_LABELS: Record<string, string> = { game_club: 'Игровой клуб', bar: 'Бар' };

export const noticeDate = (iso: string) => formatDateShort(iso, 'ru');
export const sum = (value: number) => `${formatCurrency(value)} сум`;
/** A unit price, keeping its fractions (a weighted-average cost). */
export const unitSum = (value: number) => `${formatUnitCurrency(value)} сум`;
/** A stock quantity: whole units, or up to two decimals. */
export const units = (value: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} шт.`;
export const method = (value: string | null | undefined) => (value ? PAYMENT_METHOD_LABELS[value] ?? value : '—');
export const source = (value: string | null | undefined) => (value ? SOURCE_LABELS[value] ?? value : '—');

type Part = string | null | undefined | false;

/** Details joined with " · ", skipping empty parts. */
export const details = (...parts: Part[]) => parts.filter(Boolean).join(' · ');

/** The person who wrote the entry, followed by their comment. */
export const authorLine = (author: string, comment?: string | null) => (comment ? `${author}: ${comment}` : author);

/** An entry's own comment, on a notice written by someone else (a deletion or a correction). */
export const commentLine = (comment: string | null | undefined) => (comment ? `💬 ${comment}` : null);

export const lines = (...items: Part[]) => items.filter(Boolean).join('\n');
