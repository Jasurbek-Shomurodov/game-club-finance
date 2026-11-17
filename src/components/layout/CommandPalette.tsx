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
import { requestQuickAction } from '@/lib/quickActions';
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

  function run(item: CommandItem) {
    onClose();
    if (item.pending) requestQuickAction(item.pending);
    onNavigate(item.href);
    router.push(item.href);
  }

  return { actions, pages, label, run, tCommands };
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

function CommandSearch({ titleId, onClose, role, featureAccess, onNavigate }: Omit<CommandSurfaceProps, 'open'> & { titleId: string }) {
  const { actions, pages, label, run, tCommands: t } = useCommands(role, featureAccess, onNavigate, onClose);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const labelled = (items: CommandItem[]) => items.map((item) => ({ item, label: label(item), keywords: item.keywords }));
  const matchingActions = filterCommands(labelled(actions), query);
  const matchingPages = filterCommands(labelled(pages), query);
  const results = [...matchingActions, ...matchingPages];
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
      const chosen = results[current];
      if (chosen) run(chosen.item);
    }
  }

  const group = (title: string, items: typeof results, offset: number) => items.length > 0 && (
    <div role="group" aria-label={title} className="py-1.5">
      <p className="px-4 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{title}</p>
      {items.map(({ item, label: text }, index) => {
        const Icon = ICONS[item.id] ?? Search;
        const selected = offset + index === current;
        return (
          <div
            key={item.id}
            id={`${listId}-${offset + index}`}
            role="option"
            aria-selected={selected}
            onClick={() => run(item)}
            onMouseMove={() => setActive(offset + index)}
            className={cn(
              'mx-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2.5 text-sm',
              selected ? 'bg-primary-50 font-semibold text-primary-700' : 'font-medium text-gray-700',
            )}
          >
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', item.kind === 'action' ? 'bg-primary-600 text-on-accent' : selected ? 'text-primary-600' : 'text-gray-400')}>
              <Icon size={16} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 truncate">{text}</span>
            {selected && <CornerDownLeft size={14} className="shrink-0 text-primary-500 max-sm:hidden" aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );

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
        <kbd className="hidden shrink-0 rounded-md border border-gray-200 px-1.5 py-0.5 text-[11px] font-medium text-gray-500 sm:block">Esc</kbd>
      </div>
      <div ref={listRef} id={listId} role="listbox" aria-label={t('title')} className="max-h-[min(24rem,55dvh)] overflow-y-auto pb-1.5">
        {group(t('quickActions'), matchingActions, 0)}
        {group(t('pages'), matchingPages, matchingActions.length)}
        {results.length === 0 && <p role="status" className="px-4 py-8 text-center text-sm text-gray-500">{t('noResults')}</p>}
      </div>
    </>
  );
}

/** Phones: the quick actions as a sheet of large buttons, opened by the bottom bar's "+". */
export function QuickAddSheet({ open, onClose, role, featureAccess, onNavigate }: CommandSurfaceProps) {
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
              className="flex min-h-14 items-center gap-3 rounded-2xl border border-gray-200 bg-surface px-3.5 text-left text-[15px] font-semibold text-gray-900 transition hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 active:scale-[0.99]"
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
