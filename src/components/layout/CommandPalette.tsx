'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type ElementType, type KeyboardEvent } from 'react';
import {
  BarChart3, CalendarDays, CalendarRange, ChartPie, CircleDollarSign, ClipboardList, CornerDownLeft, Gamepad2, HandCoins,
  History, LayoutDashboard, Package, PackagePlus, PiggyBank, ReceiptText, Search, Settings, Shield, ShoppingCart, Sparkles,
  Tag, UserPlus, Users, Wallet,
} from 'lucide-react';
import type { UserRole } from '@/types';
import type { FeatureKey } from '@/lib/permissions';
import { commandPages, filterCommands, quickActions, type CommandItem } from '@/lib/commands';
import { requestPageSearch, requestQuickAction, type SearchTarget } from '@/lib/quickActions';
import { createClient } from '@/lib/supabase/client';
import { EMPTY_COMMAND_SEARCH, fetchCommandSearchData, type CommandSearchData } from '@/lib/supabase/commandSearch';
import { formatCurrency } from '@/lib/formatters';
import { Modal } from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';

const ICONS: Record<string, ElementType> = {
  addExpense: ReceiptText,
  enterCash: Wallet,
  countStock: ClipboardList,
  recordPurchase: ShoppingCart,
  addDebt: UserPlus,
  'page:/dashboard': LayoutDashboard,
  'page:/financial-analysis': ChartPie,
  'page:/assistant': Sparkles,
  'page:/daily-cash': Wallet,
  'page:/closing-stock': Package,
  'page:/stock-purchase': PackagePlus,
  'page:/products': Package,
  'page:/promotions': Tag,
  'page:/reports': BarChart3,
  'page:/daily-report': CalendarDays,
  'page:/monthly-report': CalendarRange,
  'page:/money-taken': CircleDollarSign,
  'page:/reserve': PiggyBank,
  'page:/debts': Users,
  'page:/salaries': HandCoins,
  'page:/showcase': Gamepad2,
  'page:/team': Shield,
  'page:/history': History,
  'page:/settings': Settings,
};

interface CommandSurfaceProps {
  open: boolean;
  onClose: () => void;
  role: UserRole;
  featureAccess: FeatureKey[];
  /** The selected club: products and debtors are searched in it. */
  clubId: string;
  /** Tells the shell a page is being opened, for its progress bar and highlighted item. */
  onNavigate: (href: string) => void;
}

/** Labels the items in the current language and runs one: its form request first, then the navigation. */
function useCommands(role: UserRole, featureAccess: FeatureKey[], onNavigate: (href: string) => void, onClose: () => void) {
  const router = useRouter();
  const tNav = useTranslations('nav');
  const tCommands = useTranslations('commands');
  const label = (item: CommandItem) => (item.labelNs === 'nav' ? tNav(item.labelKey) : tCommands(item.labelKey));
  const actions = useMemo(() => quickActions(role, featureAccess), [role, featureAccess]);
  const pages = useMemo(() => commandPages(role, featureAccess), [role, featureAccess]);

  function open(href: string, before?: () => void) {
    onClose();
    before?.();
    onNavigate(href);
    router.push(href);
  }
  const run = (item: CommandItem) => open(item.href, item.pending ? () => requestQuickAction(item.pending!) : undefined);
  /** Opens a list page narrowed to one name. */
  const find = (target: SearchTarget, href: string, text: string) => open(href, () => requestPageSearch(target, text));

  return { actions, pages, label, run, find, tCommands };
}

/**
 * ⌘K: type a few letters of a page or an action and press Enter. Arrow keys
 * move through the results; with nothing typed it lists the quick actions and
 * every page the member can open.
 */
export function CommandPalette({ open, onClose, ...rest }: CommandSurfaceProps) {
  const titleId = useId();
  // A new key per opening: the dialog can stay mounted (hidden) between two
  // openings, and the search must not come back with what was typed last time.
  const [opening, setOpening] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpening((count) => count + 1);
  }
  return (
    <Modal open={open} onClose={onClose} size="lg" ariaLabelledBy={titleId} bodyClassName="!p-0" className="sm:mb-[18vh]">
      <CommandSearch key={opening} titleId={titleId} onClose={onClose} {...rest} />
    </Modal>
  );
}

/** One row of the palette, whatever it stands for. */
interface Entry {
  id: string;
  label: string;
  keywords: string;
  icon: ElementType;
  /** Actions get a filled icon. */
  accent?: boolean;
  /** Shown at the right, e.g. what a person owes. */
  hint?: string;
  run: () => void;
}

/** Names are searched once this much is typed, and this many of each kind are listed. */
const NAME_SEARCH_MIN_LENGTH = 2;
const NAME_RESULTS = 6;

function CommandSearch({ titleId, onClose, role, featureAccess, clubId, onNavigate }: Omit<CommandSurfaceProps, 'open'> & { titleId: string }) {
  const { actions, pages, label, run, find, tCommands: t } = useCommands(role, featureAccess, onNavigate, onClose);
  const tc = useTranslations('common');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Products and debtors by name: read once per opening, on the first real
  // search, and only the lists this member can open.
  const canFindProducts = pages.some((item) => item.href === '/products');
  const canFindDebtors = pages.some((item) => item.href === '/debts');
  const searchesNames = query.trim().length >= NAME_SEARCH_MIN_LENGTH && Boolean(clubId) && (canFindProducts || canFindDebtors);
  const [names, setNames] = useState<CommandSearchData | null>(null);
  useEffect(() => {
    if (!searchesNames || names) return;
    let cancelled = false;
    fetchCommandSearchData(createClient(), clubId, { products: canFindProducts, debts: canFindDebtors })
      .then((data) => { if (!cancelled) setNames(data); })
      // Pages and actions still work without the names.
      .catch(() => { if (!cancelled) setNames(EMPTY_COMMAND_SEARCH); });
    return () => { cancelled = true; };
  }, [canFindDebtors, canFindProducts, clubId, names, searchesNames]);

  const entry = (item: CommandItem): Entry => ({
    id: item.id, label: label(item), keywords: item.keywords, icon: ICONS[item.id] ?? Search, accent: item.kind === 'action', run: () => run(item),
  });
  const matchingActions = filterCommands(actions.map(entry), query);
  const matchingPages = filterCommands(pages.map(entry), query);
  const matchingProducts = searchesNames ? filterCommands((names?.products ?? []).map((name): Entry => ({
    id: `product:${name}`, label: name, keywords: '', icon: Package, run: () => find('products', '/products', name),
  })), query).slice(0, NAME_RESULTS) : [];
  const matchingDebtors = searchesNames ? filterCommands((names?.debtors ?? []).map((debtor): Entry => ({
    id: `debtor:${debtor.name}`, label: debtor.name, keywords: '', icon: Users,
    hint: `${formatCurrency(debtor.remaining)} ${tc('currency')}`, run: () => find('debts', '/debts', debtor.name),
  })), query).slice(0, NAME_RESULTS) : [];
  const groups: Array<[string, Entry[]]> = [
    [t('quickActions'), matchingActions],
    [t('pages'), matchingPages],
    [t('products'), matchingProducts],
    [t('debtors'), matchingDebtors],
  ];
  const results = groups.flatMap(([, entries]) => entries);
  const current = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current, query]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      results[current]?.run();
    }
  }

  let offset = 0;
  const sections = groups.map(([title, entries]) => {
    const start = offset;
    offset += entries.length;
    return entries.length > 0 && (
      <div key={title} role="group" aria-label={title} className="py-1.5">
        <p className="px-4 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</p>
        {entries.map((item, index) => {
          const Icon = item.icon;
          const selected = start + index === current;
          return (
            <div
              key={item.id}
              id={`${listId}-${start + index}`}
              role="option"
              aria-selected={selected}
              onClick={item.run}
              onMouseMove={() => setActive(start + index)}
              className={cn(
                'mx-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2.5 text-sm',
                selected ? 'bg-primary-50 font-semibold text-primary-700' : 'font-medium text-gray-700',
              )}
            >
              <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', item.accent ? 'bg-primary-600 text-on-accent' : selected ? 'text-primary-600' : 'text-gray-500')}>
                <Icon size={16} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && <span className="shrink-0 text-xs font-medium tabular-nums text-gray-500">{item.hint}</span>}
              {selected && <CornerDownLeft size={14} className="shrink-0 text-primary-500 max-sm:hidden" aria-hidden="true" />}
            </div>
          );
        })}
      </div>
    );
  });

  return (
    <>
      <h2 id={titleId} className="sr-only">{t('title')}</h2>
      <div className="flex items-center gap-3 border-b border-gray-100 px-4">
        <Search size={18} className="shrink-0 text-gray-400" aria-hidden="true" />
        <input
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results.length > 0 ? `${listId}-${current}` : undefined}
          aria-label={t('placeholder')}
          placeholder={t('placeholder')}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
          className="h-14 min-w-0 flex-1 bg-transparent text-base text-gray-950 outline-none placeholder:text-gray-400 [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd className="hidden shrink-0 rounded-md border border-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-500 sm:block">Esc</kbd>
      </div>
      <div ref={listRef} id={listId} role="listbox" aria-label={t('title')} className="max-h-[min(24rem,55dvh)] overflow-y-auto pb-1.5">
        {sections}
        {results.length === 0 && <p role="status" className="px-4 py-8 text-center text-sm text-gray-500">{t('noResults')}</p>}
      </div>
    </>
  );
}

/** Phones: the quick actions as a sheet of large buttons, opened by the bottom bar's "+". */
export function QuickAddSheet({ open, onClose, role, featureAccess, onNavigate }: Omit<CommandSurfaceProps, 'clubId'>) {
  const { actions, label, run, tCommands: t } = useCommands(role, featureAccess, onNavigate, onClose);
  return (
    <Modal open={open} onClose={onClose} title={t('quickAdd')} size="sm">
      <div className="grid gap-2">
        {actions.map((item) => {
          const Icon = ICONS[item.id] ?? Search;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => run(item)}
              className="flex min-h-14 items-center gap-3 rounded-2xl border border-gray-200 bg-surface px-3.5 text-left text-sm font-semibold text-gray-900 tappable hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-on-accent">
                <Icon size={18} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">{label(item)}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
