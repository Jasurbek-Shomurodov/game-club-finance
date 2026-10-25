/**
 * Planned expenses (migration 091): a club's recurring costs with a monthly
 * planned amount, compared with the expenses linked to them. Each preset
 * belongs to one side of the club; game club and bar plans are summarised
 * separately and never added together.
 */

export type ExpensePresetSource = 'game_club' | 'bar';

export interface ExpensePreset {
  id: string;
  name: string;
  category: string;
  payment_source: ExpensePresetSource;
  monthly_amount: number;
  sort_order: number;
  archived_at: string | null;
}

export interface PresetExpenseRow {
  date: string;
  amount: number;
  preset_id: string | null;
}

export interface ExpensePlanRow {
  preset: ExpensePreset;
  planned: number;
  actual: number;
  /** actual - planned: positive is overspent, negative is still under plan. */
  difference: number;
  /** actual / planned, percent with one decimal; null without a plan. */
  usedPct: number | null;
  count: number;
}

export interface ExpensePlanSide {
  rows: ExpensePlanRow[];
  planned: number;
  actual: number;
  difference: number;
}

export interface ExpensePlanSummary {
  gameClub: ExpensePlanSide;
  bar: ExpensePlanSide;
}

const DAY_MS = 86_400_000;
const toUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/**
 * The share of a monthly amount that falls inside the range: each calendar
 * month contributes its amount times the fraction of its days in the range.
 * A whole month is exactly the amount; a two-month range is twice it.
 */
export function plannedAmountForRange(monthlyAmount: number, range: { from: string; to: string }): number {
  if (!(monthlyAmount > 0) || range.to < range.from) return 0;
  const start = toUtc(range.from);
  const end = toUtc(range.to);
  let total = 0;
  let year = Number(range.from.slice(0, 4));
  let month = Number(range.from.slice(5, 7)) - 1;
  for (;;) {
    const monthStart = Date.UTC(year, month, 1);
    if (monthStart > end) break;
    const monthEnd = Date.UTC(year, month + 1, 0);
    const days = Math.round((monthEnd - monthStart) / DAY_MS) + 1;
    const covered = Math.round((Math.min(end, monthEnd) - Math.max(start, monthStart)) / DAY_MS) + 1;
    total += monthlyAmount * (covered / days);
    month += 1;
    if (month === 12) { month = 0; year += 1; }
  }
  return Math.round(total);
}

function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function emptySide(): ExpensePlanSide {
  return { rows: [], planned: 0, actual: 0, difference: 0 };
}

/**
 * Plan against actual for every live preset, plus archived presets that still
 * have linked spending in the range (so their money is not lost from view).
 */
export function buildExpensePlanSummary(
  presets: ExpensePreset[],
  expenses: PresetExpenseRow[],
  range: { from: string; to: string },
): ExpensePlanSummary {
  const spent = new Map<string, { amount: number; count: number }>();
  for (const row of expenses) {
    if (!row.preset_id || row.date < range.from || row.date > range.to) continue;
    const entry = spent.get(row.preset_id) ?? { amount: 0, count: 0 };
    entry.amount += Number(row.amount ?? 0);
    entry.count += 1;
    spent.set(row.preset_id, entry);
  }

  const summary: ExpensePlanSummary = { gameClub: emptySide(), bar: emptySide() };
  const ordered = [...presets].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  for (const preset of ordered) {
    const used = spent.get(preset.id);
    if (preset.archived_at && !used) continue;
    // An archived preset has no plan any more; it only shows what was paid.
    const planned = preset.archived_at ? 0 : plannedAmountForRange(Number(preset.monthly_amount), range);
    const actual = used?.amount ?? 0;
    const side = preset.payment_source === 'bar' ? summary.bar : summary.gameClub;
    side.rows.push({
      preset,
      planned,
      actual,
      difference: actual - planned,
      usedPct: pct(actual, planned),
      count: used?.count ?? 0,
    });
    side.planned += planned;
    side.actual += actual;
  }
  for (const side of [summary.gameClub, summary.bar]) side.difference = side.actual - side.planned;
  return summary;
}
