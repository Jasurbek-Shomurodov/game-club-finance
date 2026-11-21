'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type ElementType, type MouseEvent } from 'react';
import { BarChart3, CircleDollarSign, HandCoins, LayoutDashboard, Menu, Package, Plus, Users, Wallet } from 'lucide-react';
import type { UserRole } from '@/types';
import type { FeatureKey } from '@/lib/permissions';
import { DASHBOARD_PATH } from '@/lib/routes';
import { isPrimaryNavItemActive, primaryNavItems, type PrimaryNavItem } from '@/lib/navigation';
import { IconButton, NavTab } from '@/components/PresentationFoundation';

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
    <span key="quick-add" className="flex min-h-14 w-16 shrink-0 items-center justify-center">
      <IconButton
        variant="primary"
        size="lg"
        shape="round"
        label={t('quickAdd')}
        aria-haspopup="dialog"
        onClick={onQuickAdd}
        icon={<Plus size={22} strokeWidth={2.5} aria-hidden="true" />}
      />
    </span>
  );

  return (
    <nav
      aria-label={t('quickNavigation')}
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-gray-200 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {items.map((item, index) => {
        const link = (
          <NavTab
            key={item.key}
            href={item.href}
            // The dashboard embeds live totals in its server response; the sidebar prefetches the rest in full.
            prefetch={item.href === DASHBOARD_PATH ? false : undefined}
            onClick={(event) => handleClick(event, item.href)}
            active={isPrimaryNavItemActive(item, activePathname)}
            icon={ICONS[item.key]}
            label={t(item.key)}
          />
        );
        return index === addAfter ? [quickAdd, link] : link;
      })}
      {addAfter === items.length && quickAdd}
      <NavTab
        onClick={onOpenMenu}
        aria-expanded={menuOpen}
        aria-controls="mobile-nav"
        aria-haspopup="dialog"
        icon={Menu}
        label={t('more')}
        badge={menuBadge}
      />
    </nav>
  );
}
