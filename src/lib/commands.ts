import type { UserRole } from '@/types';
import { canAccessFeature, canAccessPath } from '@/lib/permissions';
import { canManageDebts } from '@/lib/calculations/debt';
import { DASHBOARD_PATH } from '@/lib/routes';
import type { TabLabelNamespace } from '@/lib/navigation';

/** A form a page opens by itself when it is reached through a quick action. */
export type PendingQuickAction = 'expense' | 'debt';

export interface CommandItem {
  id: string;
  kind: 'action' | 'page';
  /** Message namespace and key of the label. */
  labelNs: 'nav' | 'commands' | TabLabelNamespace;
  labelKey: string;
  /** For a tab of a page: the `nav` key of that page, written before the label ("Reports: Collected"). */
  parentKey?: string;
  href: string;
  /** The form the destination opens on arrival. */
  pending?: PendingQuickAction;
  /** Extra words the search matches besides the label (English, so it works in every language). */
  keywords: string;
}

const action = (id: string, href: string, keywords: string, pending?: PendingQuickAction): CommandItem => (
  { id, kind: 'action', labelNs: 'commands', labelKey: id, href, pending, keywords }
);
const page = (labelKey: string, href: string, keywords = ''): CommandItem => (
  { id: `page:${href}`, kind: 'page', labelNs: 'nav', labelKey, href, keywords: `${labelKey} ${href.slice(1)} ${keywords}` }
);

/** A tab of a page that has its own sidebar item: labelled as the tab is, under the page's name. */
const tab = (parentKey: string, labelNs: TabLabelNamespace, labelKey: string, href: string, keywords = ''): CommandItem => (
  { id: `page:${href}`, kind: 'page', labelNs, labelKey, parentKey, href, keywords: `${parentKey} ${labelKey} ${href.slice(1)} ${keywords}` }
);

/**
 * The few things done many times a day, each one tap from anywhere: the
 * phone's quick-add sheet and the top of the command palette. Only actions
 * this member may perform are offered; the pages enforce it again.
 */
export function quickActions(role: UserRole, explicitAccess: unknown): CommandItem[] {
  const can = (path: string) => canAccessPath(role, explicitAccess, path);
  const writes = role === 'owner' || role === 'admin';
  return [
    ...(canAccessFeature(role, explicitAccess, 'expenses') ? [action('addExpense', '/reports', 'expense spend cost pay', 'expense')] : []),
    ...(can('/daily-cash') ? [action('enterCash', '/daily-cash', 'cash income day shift')] : []),
    ...(can('/closing-stock') ? [action('countStock', '/closing-stock', 'stock count closing bar')] : []),
    ...(can('/stock-purchase') && writes ? [action('recordPurchase', '/stock-purchase', 'purchase buy stock bar')] : []),
    ...(can('/debts') && canManageDebts(role) ? [action('addDebt', '/debts', 'debt owe borrow', 'debt')] : []),
  ];
}

/** Every screen this member can open, in sidebar order, tabs of a section included. */
export function commandPages(role: UserRole, explicitAccess: unknown): CommandItem[] {
  const can = (path: string) => canAccessPath(role, explicitAccess, path);
  const reports = canAccessFeature(role, explicitAccess, 'reports');
  const candidates: Array<[boolean, CommandItem]> = [
    [can(DASHBOARD_PATH), page('dashboard', DASHBOARD_PATH, 'home overview')],
    [can('/financial-analysis'), page('financialAnalysis', '/financial-analysis', 'charts trends')],
    [can('/assistant'), page('assistant', '/assistant', 'ai chat')],
    [can('/daily-cash'), page('dailyCash', '/daily-cash', 'income')],
    [can('/closing-stock'), page('closingStock', '/closing-stock', 'bar count')],
    [can('/write-offs'), page('writeOffs', '/write-offs', 'bar shortage expired missing')],
    [can('/stock-purchase'), page('stockPurchase', '/stock-purchase', 'bar buy')],
    [can('/products'), page('products', '/products', 'bar catalog prices')],
    [can('/promotions'), page('promotions', '/promotions', 'bar discount')],
    // Members with only expenses still open Reports, as in the sidebar.
    [reports || canAccessFeature(role, explicitAccess, 'expenses'), page('reports', '/reports', 'expenses closeout')],
    [reports, tab('reports', 'reports', 'collectedTab', '/reports?view=collected', 'collected handover days money')],
    [reports, page('dailyReport', '/daily-report', 'day profit')],
    [reports, page('monthlyReport', '/monthly-report', 'month profit')],
    [can('/money-taken'), page('moneyTaken', '/money-taken', 'owner profit withdraw')],
    [can('/reserve'), page('reserve', '/reserve', 'savings dollars')],
    [can('/debts'), page('debts', '/debts', 'owe')],
    // Everyone sees their own salary.
    [true, page('salaries', '/salaries', 'salary staff pay')],
    [true, tab('salaries', 'salaries', 'dailyOperations', '/salaries/operations', 'salary pay advance bonus fine record')],
    [true, tab('salaries', 'salaries', 'history', '/salaries/history', 'salary payments paid past')],
    [can('/showcase'), page('showcase', '/showcase', 'public site')],
    [can('/showcase/games'), tab('showcase', 'showcase', 'libraryTitle', '/showcase/games', 'public games library')],
    [can('/showcase/google'), tab('showcase', 'showcase', 'tabGoogle', '/showcase/google', 'public google maps business posts')],
    // The brand page is the owner's.
    [role === 'owner' && can('/showcase/brand'), tab('showcase', 'showcase', 'brandTitle', '/showcase/brand', 'public brand logo')],
    [can('/team'), page('team', '/team', 'members access')],
    [can('/history'), page('history', '/history', 'audit edits')],
    // Owner-only diagnostic (permissions.ts maps it to the team feature); it has no sidebar item or tab.
    [can('/test-checklist'), page('testChecklist', '/test-checklist', 'sanity checks diagnostic data')],
    [can('/settings'), page('settings', '/settings', 'club profile')],
  ];
  return candidates.filter(([allowed]) => allowed).map(([, item]) => item);
}

const normalize = (text: string) => text.toLocaleLowerCase().replace(/[ʻʼ’'`-]/g, '').replace(/\s+/g, ' ').trim();

/**
 * The items matching what was typed, best first. Every typed word must appear
 * in the item's label or keywords; a label that starts with the query comes
 * before one that merely contains it, and otherwise the given order is kept.
 * An empty query returns everything.
 */
export function filterCommands<T extends { label: string; keywords: string }>(items: readonly T[], query: string): T[] {
  const typed = normalize(query);
  if (!typed) return [...items];
  const words = typed.split(' ');
  return items
    .map((item, index) => {
      const label = normalize(item.label);
      const haystack = `${label} ${normalize(item.keywords)}`;
      if (!words.every((word) => haystack.includes(word))) return null;
      const rank = label.startsWith(typed) ? 0 : label.includes(typed) ? 1 : 2;
      return { item, index, rank };
    })
    .filter((match): match is { item: T; index: number; rank: number } => match !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((match) => match.item);
}
