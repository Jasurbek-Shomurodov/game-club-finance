'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ElementType, type MouseEvent } from 'react';
import { BarChart3, CircleDollarSign, HandCoins, LayoutDashboard, Menu, Package, Plus, Users, Wallet } from 'lucide-react';
import type { UserRole } from '@/types';
import type { FeatureKey } from '@/lib/permissions';
import { DASHBOARD_PATH } from '@/lib/routes';
import { isPrimaryNavItemActive, primaryNavItems, type PrimaryNavItem } from '@/lib/navigation';
import { cn } from '@/lib/utils';

const ICONS: Record<PrimaryNavItem['key'], ElementType> = {
  dashboard: LayoutDashboard,
  dailyCash: Wallet,
  bar: Package,
  reports: BarChart3,
  moneyTaken: CircleDollarSign,
  debts: Users,
  salaries: HandCoins,
};

/** Fields that bring up the on-screen keyboard. */
const TYPING_SELECTOR = 'textarea, select, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"]):not([type="file"])';

/**
 * Whether the person is typing into a field. The bottom bar steps aside then:
 * above an open phone keyboard it would cover the form being filled in.
 */
export function useTypingInField(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const check = () => setTyping(Boolean(document.activeElement?.matches(TYPING_SELECTOR)));
    // focusout fires before the next element takes focus; read the result after.
    const later = () => window.setTimeout(check, 0);
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', later);
    return () => {
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', later);
    };
  }, []);
  return typing;
}

const ITEM_CLASS = 'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500';

interface BottomNavProps {
  role: UserRole;
  featureAccess: FeatureKey[];
  /** The page being opened, so the tapped item lights up at once. */
  activePathname: string;
  menuOpen: boolean;
  onOpenMenu: () => void;
  /** Something in the menu is waiting (open access requests); shown as a count on the menu button. */
  menuBadge?: number;
  /** Opens the quick-add sheet; without it (nothing this member can add) the bar shows one more screen instead. */
  onQuickAdd?: () => void;
  onNavigate: (href: string) => void;
}

/**
 * Phones only: the everyday screens one tap away at the bottom of the screen,
 * with the full menu behind the last button. Wider screens have the sidebar.
 */
export function BottomNav({ role, featureAccess, activePathname, menuOpen, onOpenMenu, menuBadge = 0, onQuickAdd, onNavigate }: BottomNavProps) {
  const t = useTranslations('nav');
  // With the "+" in the middle there is room for three screens around it.
  const items = primaryNavItems(role, featureAccess, onQuickAdd ? 3 : 4);
  const addAfter = onQuickAdd ? Math.min(2, items.length) : -1;

  function handleClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    onNavigate(href);
  }

  const quickAdd = onQuickAdd && (
    <button
      key="quick-add"
      type="button"
      onClick={onQuickAdd}
      aria-label={t('quickAdd')}
      aria-haspopup="dialog"
      className="flex min-h-14 w-16 shrink-0 items-center justify-center focus-visible:outline-none [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-primary-500 [&:focus-visible>span]:ring-offset-2"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-600 text-on-accent shadow-pop transition active:scale-95">
        <Plus size={22} strokeWidth={2.5} aria-hidden="true" />
      </span>
    </button>
  );

  return (
    <nav
      aria-label={t('quickNavigation')}
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-gray-200 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {items.map((item, index) => {
        const Icon = ICONS[item.key];
        const active = isPrimaryNavItemActive(item, activePathname);
        const link = (
          <Link
            key={item.key}
            href={item.href}
            // The dashboard embeds live totals in its server response; the sidebar prefetches the rest in full.
            prefetch={item.href === DASHBOARD_PATH ? false : undefined}
            onClick={(event) => handleClick(event, item.href)}
            aria-current={active ? 'page' : undefined}
            className={cn(ITEM_CLASS, active ? 'font-semibold text-primary-700' : 'font-medium text-gray-500 hover:text-gray-950')}
          >
            <Icon size={20} strokeWidth={active ? 2.25 : 2} aria-hidden="true" />
            <span className="max-w-full truncate">{t(item.key)}</span>
          </Link>
        );
        return index === addAfter ? [quickAdd, link] : link;
      })}
      {addAfter === items.length && quickAdd}
      <button
        type="button"
        onClick={onOpenMenu}
        aria-expanded={menuOpen}
        aria-controls="mobile-nav"
        aria-haspopup="dialog"
        className={cn(ITEM_CLASS, 'font-medium text-gray-500 hover:text-gray-950')}
      >
        <span className="relative">
          <Menu size={20} aria-hidden="true" />
          {menuBadge > 0 && (
            <span className="absolute -right-3 -top-1.5 min-w-4 rounded-full bg-warning-50 px-1 text-center text-[10px] font-semibold leading-4 text-warning-700 ring-1 ring-surface">
              {menuBadge}
            </span>
          )}
        </span>
        <span className="max-w-full truncate">{t('more')}</span>
      </button>
    </nav>
  );
}
