import type { UserRole } from '@/types';
import type { MoneyCheck } from '@/lib/calculations/moneyChecks';
import type { UpcomingPayments } from '@/lib/calculations/upcomingPayments';
import {
  dailyReportHref,
  debtsHref,
  financialAnalysisHref,
  moneyCheckHref,
  moneyDetailsHref,
  ownerProfitHref,
  productsHref,
  reportsHref,
  reserveHistoryHref,
  type DateRange,
} from '@/lib/detailLinks';
import { canAccessPath } from '@/lib/permissions';
import type { AssistantDataset, DataTable } from './datasets';
import { hrefPath, internalHref } from './markdownLinks';

/**
 * Record links handed to the model with each dataset: the app pages that list
 * the records behind its figures. The model may only link to these, so each
 * one is built with detailLinks and kept only when the member may open it.
 */
export interface AssistantLink {
  /** What the page shows, for the model to pick the right link. Not shown to the user. */
  label: string;
  href: string;
}

export interface LinkAccess {
  role: UserRole;
  featureAccess: unknown;
  /** The club's business date. */
  businessToday: string;
}

/** More links than this only add noise to the model's context. */
export const MAX_LINKS = 40;
/** Per-day daily-report links are offered for periods up to this many days. */
export const MAX_DAY_LINKS = 31;

function canOpen(access: LinkAccess, href: string): boolean {
  return canAccessPath(access.role, access.featureAccess, hrefPath(href));
}

/** Drops links the member may not open and repeats, keeping the first MAX_LINKS. */
function allowed(access: LinkAccess, links: AssistantLink[]): AssistantLink[] {
  const seen = new Set<string>();
  const result: AssistantLink[] = [];
  for (const link of links) {
    // Only links the reply renderer will accept (ASSISTANT_LINK_PATHS), so the model is never offered a dead one.
    if (seen.has(link.href) || !internalHref(link.href) || !canOpen(access, link.href)) continue;
    seen.add(link.href);
    result.push(link);
    if (result.length === MAX_LINKS) break;
  }
  return result;
}

const periodText = (period: DateRange) => (period.from === period.to ? period.from : `${period.from} to ${period.to}`);

/** The `YYYY-MM` a period sits in, when it is inside one month. */
const singleMonth = (period: DateRange) => (period.from.slice(0, 7) === period.to.slice(0, 7) ? period.from.slice(0, 7) : null);

function textCells(table: DataTable, key: string): string[] {
  return [...new Set(table.rows.map((row) => row[key]).filter((value): value is string => typeof value === 'string' && value !== ''))];
}

/** Links for the datasets read straight from the ledgers; `checks`, `upcoming` and `outlook` have their own builders. */
export function datasetLinks(
  input: { dataset: AssistantDataset; table: DataTable; period?: DateRange; category?: string },
  access: LinkAccess,
): AssistantLink[] {
  const { dataset, table, period } = input;
  const links: AssistantLink[] = [];
  const month = period ? singleMonth(period) : null;
  const moneyDetails = (range: DateRange) => [
    { label: `Game club money details, ${periodText(range)}`, href: moneyDetailsHref('game_club', range) },
    { label: `Bar money details, ${periodText(range)}`, href: moneyDetailsHref('bar', range) },
  ];

  switch (dataset) {
    case 'summary':
      if (!period) break;
      if (month) links.push({ label: `Financial analysis, ${month}`, href: financialAnalysisHref(month) });
      links.push({ label: `Reports, ${periodText(period)}`, href: reportsHref(period) }, ...moneyDetails(period));
      break;
    case 'money':
      if (!period) break;
      links.push(
        { label: `Reports: money in, ${periodText(period)}`, href: reportsHref(period, { category: 'money_in' }) },
        { label: `Reports: expenses, ${periodText(period)}`, href: reportsHref(period, { category: 'expense' }) },
        ...moneyDetails(period),
      );
      break;
    case 'daily': {
      if (!period) break;
      links.push({ label: `Reports, ${periodText(period)}`, href: reportsHref(period) });
      const dates = textCells(table, 'date');
      if (dates.length <= MAX_DAY_LINKS) {
        links.push(...dates.map((date) => ({ label: `Daily report, ${date}`, href: dailyReportHref(date) })));
      }
      break;
    }
    case 'monthly':
      links.push(...textCells(table, 'month').map((value) => ({ label: `Financial analysis, ${value}`, href: financialAnalysisHref(value) })));
      break;
    case 'categories':
      if (!period) break;
      links.push(
        { label: `Reports: all expenses, ${periodText(period)}`, href: reportsHref(period, { category: 'expense' }) },
        ...textCells(table, 'category').map((category) => ({
          label: `Reports: ${category} expenses, ${periodText(period)}`,
          href: reportsHref(period, { category: `expense:${category}` }),
        })),
      );
      break;
    case 'expenses':
      if (!period) break;
      links.push(input.category
        ? { label: `Reports: ${input.category} expenses, ${periodText(period)}`, href: reportsHref(period, { category: `expense:${input.category}` }) }
        : { label: `Reports: all expenses, ${periodText(period)}`, href: reportsHref(period, { category: 'expense' }) });
      break;
    case 'product_sales':
      if (!period) break;
      links.push({ label: `Bar money details, ${periodText(period)}`, href: moneyDetailsHref('bar', period) });
      break;
    case 'stock':
      links.push({ label: 'Products and stock', href: productsHref() });
      break;
    case 'debts':
      links.push({ label: 'Customer debts', href: debtsHref() });
      break;
    case 'checks':
    case 'upcoming':
    case 'outlook':
      break;
  }
  return allowed(access, links);
}

/** One link per check (the records behind it, as on Financial Analysis), after the month's page. */
export function moneyCheckLinks(checks: readonly MoneyCheck[], month: string, access: LinkAccess): AssistantLink[] {
  const checkAccess = {
    canOpen: (path: string) => canAccessPath(access.role, access.featureAccess, path),
    isOwner: access.role === 'owner',
    businessMonth: access.businessToday.slice(0, 7),
  };
  const links: AssistantLink[] = [{ label: `Financial analysis, ${month}`, href: financialAnalysisHref(month) }];
  for (const check of checks) {
    const href = moneyCheckHref(check, checkAccess);
    if (!href) continue;
    const parts = [check.kind, check.side, check.category, check.date ?? periodText(check.range)].filter(Boolean);
    links.push({ label: `Check: ${parts.join(', ')}`, href });
  }
  return allowed(access, links);
}

/** The month's plans and each plan's expenses in Reports, as on the plan panel. */
export function upcomingLinks(upcoming: UpcomingPayments | null, range: DateRange, access: LinkAccess): AssistantLink[] {
  const month = range.from.slice(0, 7);
  const links: AssistantLink[] = [{ label: `Financial analysis (expense plans), ${month}`, href: financialAnalysisHref(month) }];
  for (const row of upcoming ? [...upcoming.gameClub.rows, ...upcoming.bar.rows] : []) {
    links.push({
      label: `Plan "${row.preset.name}" (${row.preset.payment_source}): its expenses in Reports, ${month}`,
      href: reportsHref(range, { category: `expense:${row.preset.category}`, source: row.preset.payment_source }),
    });
  }
  return allowed(access, links);
}

/**
 * The pages behind the month outlook: the forecast and the plans on Financial
 * Analysis, money in and expenses in Reports, each side's money details, and
 * Owner Profit and the reserve's ledger when the outlook has their rows.
 */
export function outlookLinks(period: DateRange, access: LinkAccess, options: { ownerProfit: boolean; reserve: boolean }): AssistantLink[] {
  const month = period.from.slice(0, 7);
  return allowed(access, [
    { label: `Financial analysis (month-end forecast and expense plans), ${month}`, href: financialAnalysisHref(month) },
    { label: `Reports: money in, ${periodText(period)}`, href: reportsHref(period, { category: 'money_in' }) },
    { label: `Reports: expenses, ${periodText(period)}`, href: reportsHref(period, { category: 'expense' }) },
    { label: `Game club money details (money left), ${periodText(period)}`, href: moneyDetailsHref('game_club', period) },
    { label: `Bar money details (money left), ${periodText(period)}`, href: moneyDetailsHref('bar', period) },
    ...(options.ownerProfit ? [{ label: `Owner profit: withdrawals and what is left after them, ${month}`, href: ownerProfitHref() }] : []),
    ...(options.reserve ? [{ label: 'Owner reserve ledger', href: reserveHistoryHref() }] : []),
  ]);
}
