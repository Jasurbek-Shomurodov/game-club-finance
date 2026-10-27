import type { ExpenseRow } from './dashboardMetrics';
import {
  BAR_COST_TARGET,
  OTHER_CATEGORY,
  analysisTotals,
  barFlow,
  gameClubFlow,
  foldCategories,
  groupExpensesByCategory,
  incomeSources,
  type AnalysisLedgers,
  type CategoryAmount,
  type SankeyNode,
} from './financialAnalysis';

/**
 * The analysis money flows. The game club and the bar each get their own
 * Sankey; their money is never joined into one hub. Each node may carry
 * `open`, the drill-down it leads to, so the dialog can keep going: a category
 * opens its own payments from that side's money, a group of payments the
 * payments in it, and one payment its details.
 */
export type PaymentSource = 'game_club' | 'bar';

export type DrillTarget =
  | { kind: 'gameClub' }
  | { kind: 'bar' }
  | {
      kind: 'category';
      category: string;
      /** Only the payments made from this money. */
      source?: PaymentSource;
      /** For the folded "other" category: the categories drawn on their own, which it leaves out. */
      named?: string[];
      /** Only the payments with these comment keys (`NOTE_PREFIX…` or `NO_COMMENT`), drawn one by one. */
      notes?: string[];
    }
  | {
      kind: 'payment';
      id: string;
      /** Where the details link opens: the payment's day, category and money. */
      date: string;
      category: string;
      source: PaymentSource;
    };

export interface DrillNode extends SankeyNode {
  open?: DrillTarget;
}

export interface DrillSankey {
  sources: DrillNode[];
  targets: DrillNode[];
  /** Height of the middle column: the larger of either side. */
  total: number;
  /** What flows into the hub. */
  income: number;
}

export const GAME_CLUB_LEFT = '__game_club_left';
export const BAR_LEFT = '__bar_left';
export const PAID_FROM_GAME_CLUB = '__paid_game_club';
export const PAID_FROM_BAR = '__paid_bar';
export const NO_COMMENT = '__no_comment';
export const MORE_PAYMENTS = '__more_payments';
/** A group of a category's payments sharing one comment. */
export const NOTE_PREFIX = '__note:';
/** One payment, drawn on its own. */
export const PAYMENT_PREFIX = '__payment:';
/** Payment comments drawn on their own before the rest fold together. */
export const TOP_NOTE_COUNT = 7;

const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);
const amountOf = (row: { amount?: number | null }) => Number(row.amount ?? 0);
const isBar = (row: ExpenseRow) => row.payment_source === 'bar';
/** The comment group a payment falls in. */
const noteKey = (row: ExpenseRow) => (row.comment?.trim() ? `${NOTE_PREFIX}${row.comment.trim()}` : NO_COMMENT);

/** The details of one payment. */
export function paymentTarget(row: ExpenseRow): Extract<DrillTarget, { kind: 'payment' }> {
  return { kind: 'payment', id: row.id, date: row.date, category: row.category, source: isBar(row) ? 'bar' : 'game_club' };
}

function drill(sources: DrillNode[], targets: DrillNode[]): DrillSankey {
  const shown = (nodes: DrillNode[]) => nodes.filter((node) => node.amount > 0);
  const left = shown(sources);
  const right = shown(targets);
  const income = sum(left, (node) => node.amount);
  return { sources: left, targets: right, total: Math.max(income, sum(right, (node) => node.amount)), income };
}

/** Categories as Sankey targets, each opening its payments from `source`. */
function categoryTargets(rows: ExpenseRow[], source?: PaymentSource): DrillNode[] {
  const top = foldCategories(groupExpensesByCategory(rows));
  return top.map((row) => ({ key: row.category, amount: row.amount, open: categoryTarget(row.category, top, source) }));
}

function categoryTarget(category: string, top: CategoryAmount[], source?: PaymentSource): DrillTarget {
  return category === OTHER_CATEGORY
    ? { kind: 'category', category, source, named: top.map((row) => row.category).filter((key) => key !== OTHER_CATEGORY) }
    : { kind: 'category', category, source };
}

/** Where an amount left over, or a loss not covered by this side's own money, goes in its Sankey. */
function remainder(left: number, leftKey: string, sources: DrillNode[], targets: DrillNode[]) {
  if (left > 0) targets.push({ key: leftKey, amount: left });
  if (left < 0) sources.push({ key: 'shortfall', amount: -left });
}

/** The payments behind a category drill-down, newest first. */
export function drillExpenseRows(target: Extract<DrillTarget, { kind: 'category' }>, expenseRows: ExpenseRow[]): ExpenseRow[] {
  const named = new Set(target.named ?? []);
  const notes = target.notes && new Set(target.notes);
  return expenseRows
    .filter((row) => !target.source || (target.source === 'bar') === isBar(row))
    .filter((row) => (
      target.category === OTHER_CATEGORY ? !named.has(row.category || OTHER_CATEGORY) : row.category === target.category
    ))
    .filter((row) => !notes || notes.has(noteKey(row)))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
}

function categoryDrill(target: Extract<DrillTarget, { kind: 'category' }>, expenseRows: ExpenseRow[]): DrillSankey {
  const rows = drillExpenseRows(target, expenseRows);
  const barRows = rows.filter(isBar);
  // Each side's money opens its own flow.
  const sources: DrillNode[] = [
    { key: PAID_FROM_GAME_CLUB, amount: sum(rows, amountOf) - sum(barRows, amountOf), open: { kind: 'gameClub' } },
    { key: PAID_FROM_BAR, amount: sum(barRows, amountOf), open: { kind: 'bar' } },
  ];
  // A group of payments draws each payment, opening its details.
  if (target.notes) {
    return drill(sources, rows.map((row) => ({ key: `${PAYMENT_PREFIX}${row.id}`, amount: amountOf(row), open: paymentTarget(row) })));
  }
  // The folded category splits into the categories it holds, each opening its own payments.
  if (target.category === OTHER_CATEGORY) {
    return drill(sources, groupExpensesByCategory(rows).map((row) => ({
      key: row.category,
      amount: row.amount,
      open: row.category === OTHER_CATEGORY
        ? undefined
        : { kind: 'category', category: row.category, source: target.source },
    })));
  }
  // Anything else splits by what its payments were for. A comment on one payment opens that payment; one shared by
  // several, and the folded rest, open their payments.
  const byNote = new Map<string, ExpenseRow[]>();
  for (const row of rows) byNote.set(noteKey(row), [...byNote.get(noteKey(row)) ?? [], row]);
  const group = (keys: string[], payments: ExpenseRow[]): DrillTarget | undefined => (
    payments.length === 1 ? paymentTarget(payments[0]) : payments.length > 1 ? { ...target, notes: keys } : undefined
  );
  const notes = Array.from(byNote, ([key, payments]) => ({ key, amount: sum(payments, amountOf), payments }))
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
  const top: DrillNode[] = notes.slice(0, TOP_NOTE_COUNT).map(({ key, amount, payments }) => ({ key, amount, open: group([key], payments) }));
  const rest = notes.slice(TOP_NOTE_COUNT);
  const more = { key: MORE_PAYMENTS, amount: sum(rest, (node) => node.amount), open: group(rest.map((node) => node.key), rest.flatMap((node) => node.payments)) };
  return drill(sources, more.amount > 0 ? [...top, more] : top);
}

/** The Sankey a drill-down draws for the period's ledgers. */
export function buildDrillSankey(target: DrillTarget, ledgers: AnalysisLedgers): DrillSankey {
  const totals = analysisTotals(ledgers);
  const gameClubRows = ledgers.expenseRows.filter((row) => !isBar(row));
  const barRows = ledgers.expenseRows.filter(isBar);
  const gameClubLeft = gameClubFlow(totals).left;
  const barLeft = barFlow(totals).left;

  switch (target.kind) {
    case 'gameClub': {
      const sources: DrillNode[] = incomeSources(totals).filter((node) => node.key !== 'bar');
      const targets = categoryTargets(gameClubRows, 'game_club');
      remainder(gameClubLeft, GAME_CLUB_LEFT, sources, targets);
      return drill(sources, targets);
    }
    case 'bar': {
      const sources: DrillNode[] = [{ key: 'bar', amount: totals.barSales }];
      const targets: DrillNode[] = [{ key: BAR_COST_TARGET, amount: totals.barCost }, ...categoryTargets(barRows, 'bar')];
      remainder(barLeft, BAR_LEFT, sources, targets);
      return drill(sources, targets);
    }
    case 'category':
      return categoryDrill(target, ledgers.expenseRows);
    case 'payment': {
      // One payment: the money that paid it, flowing to the payment.
      const row = ledgers.expenseRows.find((item) => item.id === target.id);
      const amount = row ? amountOf(row) : 0;
      return drill(
        [{ key: target.source === 'bar' ? PAID_FROM_BAR : PAID_FROM_GAME_CLUB, amount, open: { kind: target.source === 'bar' ? 'bar' : 'gameClub' } }],
        [{ key: `${PAYMENT_PREFIX}${target.id}`, amount }],
      );
    }
  }
}

/**
 * The page behind a drill-down, with its period (and category) as filters: a
 * category opens Reports filtered to it; the folded "other" opens every expense.
 */
export function drillDetailsHref(target: DrillTarget, range: { from: string; to: string }): string {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  switch (target.kind) {
    case 'gameClub':
      return `/game-club-money-details?${params}`;
    case 'bar':
      return `/bar-money-details?${params}`;
    case 'category':
      params.set('category', target.category === OTHER_CATEGORY ? 'expense' : `expense:${target.category}`);
      // The popup showed only this side's payments; the list must match it.
      if (target.source) params.set('source', target.source);
      return `/reports?${params}`;
    case 'payment':
      // A payment opens Reports on its own day, category and money.
      return `/reports?${new URLSearchParams({ from: target.date, to: target.date, category: `expense:${target.category}`, source: target.source })}`;
  }
}
