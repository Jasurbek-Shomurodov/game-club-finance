'use client';

import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

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
}

const HASH_PREFIX = '#club-';
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Sticky pill tabs, one per club, with a glowing indicator that slides to the
 * active tab. "#club-<slug>" links anywhere on the page open that club.
 */
export function ClubTabs({ tabs, children, anchorId }: ClubTabsProps) {
  const panels = Children.toArray(children);
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  const open = useCallback((id: string, scroll: boolean) => {
    if (!tabs.some((tab) => tab.id === id)) return;
    setActive(id);
    if (scroll) document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        list.scrollTo({ left: button.offsetLeft - 8, behavior: 'smooth' });
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

  return (
    <div>
      <div className="sc-tabs sticky top-16 z-40 -mx-4 px-4 py-3 sm:mx-0 sm:px-0">
        <div
          ref={listRef}
          role="tablist"
          aria-label="Clubs"
          className="sc-glass relative mx-auto flex w-max max-w-full gap-1 overflow-x-auto rounded-2xl bg-[#0a0a14]/85 p-1.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.8)] [scrollbar-width:none]"
        >
          {indicator && (
            <span
              aria-hidden="true"
              className="sc-tab-indicator absolute bottom-1.5 top-1.5 rounded-xl"
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
                onClick={() => select(tab.id)}
                className={cn(
                  'relative z-[1] flex shrink-0 flex-col items-start rounded-xl px-4 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300',
                  selected ? 'text-white' : 'text-white/55 hover:text-white',
                )}
              >
                <span className="sc-display whitespace-nowrap text-sm font-bold">{tab.label}</span>
                {tab.meta && <span className={cn('whitespace-nowrap text-[11px]', selected ? 'text-white/75' : 'text-white/40')}>{tab.meta}</span>}
              </button>
            );
          })}
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
