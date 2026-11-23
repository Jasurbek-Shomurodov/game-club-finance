'use client';

import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { scrollBehavior } from '@/lib/scroll';

export interface ClubTab {
  id: string;
  label: string;
  meta?: string;
}

interface ClubTabsProps {
  tabs: ClubTab[];
  /** One panel per tab, in the same order. Every panel is server-rendered; inactive ones are hidden. */
  children: ReactNode;
  /** Element id scrolled into view when a club is picked from elsewhere on the page. */
  anchorId: string;
  /** Translated name of the tab list for screen readers. */
  label: string;
}

const HASH_PREFIX = '#club-';
/** "#sec-prices" links (the top bar, the footer) lead to that section of the club now shown. */
const SECTION_PREFIX = '#sec-';
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The club switch: a solid bar that sticks under the top bar, one tab per
 * club, with an indicator that slides to the active tab. Everything below it
 * belongs to the chosen club. "#club-<slug>" links anywhere on the page open
 * that club; "#sec-<name>" links scroll to that section of the open club.
 */
export function ClubTabs({ tabs, children, anchorId, label }: ClubTabsProps) {
  const panels = Children.toArray(children);
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  const open = useCallback((id: string, scroll: boolean) => {
    if (!tabs.some((tab) => tab.id === id)) return;
    setActive(id);
    if (scroll) document.getElementById(anchorId)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }, [anchorId, tabs]);

  useEffect(() => {
    const fromHash = (scroll: boolean) => {
      if (window.location.hash.startsWith(HASH_PREFIX)) open(window.location.hash.slice(HASH_PREFIX.length), scroll);
    };
    fromHash(false);
    const onHashChange = () => fromHash(true);
    // Clicking a "#club-<slug>" link that matches the current hash fires no
    // hashchange, so handle the click itself: open and scroll every time.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const section = (event.target as Element | null)?.closest?.('a[href^="#sec-"]');
      if (section) {
        const name = section.getAttribute('href')!.slice(SECTION_PREFIX.length);
        // The open club's panel is the only one not hidden.
        const target = document.querySelector(`[role="tabpanel"]:not([hidden]) [data-section="${CSS.escape(name)}"]`);
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
        return;
      }
      const link = (event.target as Element | null)?.closest?.('a[href^="#club-"]');
      if (!link) return;
      const id = link.getAttribute('href')!.slice(HASH_PREFIX.length);
      if (!tabs.some((tab) => tab.id === id)) return;
      event.preventDefault();
      window.history.replaceState(null, '', `${HASH_PREFIX}${id}`);
      open(id, true);
    };
    window.addEventListener('hashchange', onHashChange);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      document.removeEventListener('click', onClick);
    };
  }, [open, tabs]);

  useIsomorphicLayoutEffect(() => {
    const measure = () => {
      const button = listRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(active)}"]`);
      if (!button) return;
      setIndicator({ left: button.offsetLeft, width: button.offsetWidth });
      // Scroll only the tab strip sideways; scrollIntoView would also move the page
      // and cancel the smooth scroll to the clubs section.
      const list = listRef.current;
      if (list && (button.offsetLeft < list.scrollLeft || button.offsetLeft + button.offsetWidth > list.scrollLeft + list.clientWidth)) {
        list.scrollTo({ left: button.offsetLeft - 8, behavior: scrollBehavior() });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [active]);

  function select(id: string) {
    setActive(id);
    window.history.replaceState(null, '', `${HASH_PREFIX}${id}`);
  }

  // One Tab stop; arrows, Home and End move between clubs, as a tab list should.
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === active);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0 || !tabs[next]) return;
    event.preventDefault();
    select(tabs[next].id);
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(tabs[next].id)}"]`)?.focus();
  }

  return (
    <div>
      <div className="sc-tabs sticky top-16 z-40">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2 sm:px-6 lg:px-8">
          <span className="hidden text-xs font-semibold uppercase tracking-wider text-white/60 sm:block" aria-hidden="true">{label}</span>
          <div
            ref={listRef}
            role="tablist"
            aria-label={label}
            onKeyDown={onKeyDown}
            className="relative flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-xl bg-white/[0.06] p-1 [scrollbar-width:none] sm:flex-none"
          >
            {indicator && (
              <span
                aria-hidden="true"
                className="sc-tab-indicator absolute bottom-1 top-1 rounded-lg"
                style={{ left: indicator.left, width: indicator.width }}
              />
            )}
            {tabs.map((tab) => {
              const selected = tab.id === active;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`tab-${tab.id}`}
                  data-tab={tab.id}
                  aria-selected={selected}
                  aria-controls={`panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(tab.id)}
                  className={cn(
                    'relative z-[1] min-h-11 flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 sm:flex-none sm:px-5',
                    selected ? 'text-white' : 'text-white/65 hover:text-white',
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          {tabs.map((tab) => (tab.id === active && tab.meta ? (
            <span key={tab.id} className="hidden min-w-0 truncate text-sm text-white/65 lg:block">{tab.meta}</span>
          ) : null))}
        </div>
      </div>
      {panels.map((panel, index) => {
        const tab = tabs[index];
        if (!tab) return null;
        const selected = tab.id === active;
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`panel-${tab.id}`}
            aria-labelledby={`tab-${tab.id}`}
            hidden={!selected}
            className={selected ? 'sc-panel-in' : undefined}
          >
            {panel}
          </div>
        );
      })}
    </div>
  );
}
