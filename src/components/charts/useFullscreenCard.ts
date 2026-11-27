'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Classes a chart card takes while it fills the window: laid over the app
 * shell (above the top bar, bottom navigation and sidebar, under dialogs and
 * drawers), the full dynamic viewport height so iOS Safari's toolbars do not
 * cut it, its own scrolling. `ChartCard` applies them through its
 * `fullscreen` prop.
 */
// `!m-0`: a parent's `space-y-*` margin outranks a plain `m-0` and would push the card down from the top edge.
export const fullscreenCardClassName =
  'fixed inset-0 z-50 !m-0 flex h-[100dvh] w-full flex-col overflow-y-auto overscroll-contain rounded-none border-0 shadow-none ' +
  'pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]';

/** Classes for the chart's own box inside a full-screen card: it takes the room the rest of the card leaves. */
export const fullscreenChartClassName = 'min-h-80 flex-1 overflow-hidden';

/** What `inertOutside` reads and sets on an element; an `HTMLElement` has all of it. */
export interface InertTarget {
  parentElement: InertTarget | null;
  children: ArrayLike<unknown>;
  inert?: boolean;
  tagName?: string;
  hasAttribute?: (name: string) => boolean;
}

/** Never made inert: what holds no content, and live regions, which must still announce. */
const keepsWorking = (node: InertTarget) => /^(SCRIPT|STYLE|TEMPLATE|LINK)$/.test(node.tagName ?? '') || !!node.hasAttribute?.('aria-live');

/** The shell made inert around a full-screen card (`inertOutside`). */
export interface InertShell {
  /** The card's ancestors below the root: an element added to one of them later is shell content and must be made inert too. */
  watched: InertTarget[];
  /** Makes a newly added child of a watched element inert, unless it holds the card. */
  add: (child: InertTarget) => void;
  /** Undoes every change, including those made by `add`. */
  restore: () => void;
}

/**
 * Makes everything on the page outside `element` inert (no focus, no clicks,
 * hidden from assistive tech): every sibling of the element and of each of
 * its ancestors up to `root`. Children added to `root` later, such as a
 * dialog the card opens (dialogs portal to the body), are left alone; the
 * caller hands children added anywhere else on the card's path to `add`.
 */
export function inertOutside(element: InertTarget, root: InertTarget | null): InertShell {
  const changed: InertTarget[] = [];
  const path = new Set<InertTarget>();
  const watched: InertTarget[] = [];
  const add = (child: InertTarget) => {
    if (path.has(child) || child.inert || keepsWorking(child)) return;
    child.inert = true;
    changed.push(child);
  };
  for (let node: InertTarget | null = element; node && node !== root; node = node.parentElement) {
    path.add(node);
    const parent: InertTarget | null = node.parentElement;
    if (!parent) break;
    if (parent !== root) watched.push(parent);
    for (const child of Array.from(parent.children) as InertTarget[]) add(child);
  }
  return {
    watched,
    add,
    restore: () => {
      for (const node of changed) node.inert = false;
    },
  };
}

/** Whether a dialog or drawer is open over the page, so Escape is theirs. */
function dialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"][aria-modal="true"]');
}

export interface FullscreenCard {
  open: boolean;
  toggle: () => void;
  close: () => void;
  /** Put on the chart's own box, so `chartHeight` can measure it. */
  chartRef: RefObject<HTMLDivElement>;
  /** The chart box's height in pixels while full screen, for a chart that lays out to a fixed height; undefined in the page. */
  chartHeight: number | undefined;
}

/**
 * A card that fills the window and comes back. The card stays where it is in
 * the page, so everything it shows (the period, hidden lines, an open day)
 * keeps its state; only its classes change. While it is open the page behind
 * does not scroll and is inert, so Tab and a screen reader stay inside the
 * card; Escape returns it, unless a dialog opened from the card has the key,
 * and focus goes back where it was when the card opened.
 */
export function useFullscreenCard(): FullscreenCard {
  const [open, setOpen] = useState(false);
  const [chartHeight, setChartHeight] = useState<number>();
  const chartRef = useRef<HTMLDivElement>(null);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    // The root, not the body: a dialog opened from the card locks and restores the body on its own.
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    // `ChartCard` marks the card that fills the window; the rest of the shell stops taking focus and clicks.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const card = chartRef.current?.closest<HTMLElement>('[data-fullscreen]') ?? null;
    const shell = card ? inertOutside(card, document.body) : null;
    // Shell content that mounts while the card fills the window (a banner, a toast in the page) goes inert as well.
    const mounts = shell && typeof MutationObserver !== 'undefined'
      ? new MutationObserver((records) => {
        for (const record of records) {
          for (const added of Array.from(record.addedNodes)) if (added instanceof HTMLElement) shell.add(added);
        }
      })
      : null;
    for (const parent of shell?.watched ?? []) mounts?.observe(parent as unknown as Node, { childList: true });
    // Focus that was left outside (the card opened by a shortcut) moves into the card.
    const addedTabIndex = !!card && !card.contains(document.activeElement) && !card.hasAttribute('tabindex');
    if (addedTabIndex) card?.setAttribute('tabindex', '-1');
    if (card && !card.contains(document.activeElement)) card.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || dialogOpen()) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);

    const chart = chartRef.current;
    const measure = () => setChartHeight(chart ? Math.floor(chart.clientHeight) : undefined);
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (chart) sizes?.observe(chart);
    measure();

    return () => {
      root.style.overflow = overflow;
      mounts?.disconnect();
      shell?.restore();
      if (addedTabIndex) card?.removeAttribute('tabindex');
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      document.removeEventListener('keydown', onKey);
      sizes?.disconnect();
      setChartHeight(undefined);
    };
  }, [open]);

  return { open, toggle, close, chartRef, chartHeight };
}
