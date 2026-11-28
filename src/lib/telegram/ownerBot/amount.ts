/**
 * The owner's typed answer to "✏️ Другая сумма": a whole number of sum, with
 * spaces (any kind) or dots or commas between thousands, and an optional
 * "сум" after it ("1 200 000", "1.200.000", "500000 сум"). Anything else
 * (a fraction, a sign, words, more than a trillion) is not an amount and the
 * question is asked again. Whether it is above 0 and at most what may be
 * taken is the database's check (owner_bot_answer_amount, 193).
 */

/** Far above any day's money; keeps the number exact. */
const MAX_AMOUNT = 1_000_000_000_000;

const CURRENCY_SUFFIX = /\s*(сум|сўм|so['’`]?m|sum|uzs)\.?$/iu;
const THOUSANDS_GROUPED = /^\d{1,3}(?:[.,]\d{3})+$/;
const DIGITS = /^\d+$/;

export function parseOwnerBotAmount(text: string): number | null {
  const compact = text.trim().replace(CURRENCY_SUFFIX, '').replace(/[\s  ]+/gu, '');
  if (!DIGITS.test(compact) && !THOUSANDS_GROUPED.test(compact)) return null;
  const amount = Number(compact.replace(/[.,]/g, ''));
  return Number.isSafeInteger(amount) && amount <= MAX_AMOUNT ? amount : null;
}
