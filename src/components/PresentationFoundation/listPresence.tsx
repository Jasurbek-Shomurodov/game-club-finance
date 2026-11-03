'use client';

import { createElement, useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { DIALOG_EXIT_MS } from './motion';

export type Presence = 'enter' | 'exit';

export interface PresenceEntry<T> {
  key: string;
  item: T;
  /** Set while the row is growing in or folding away; undefined once it rests. */
  presence?: Presence;
}

/**
 * More changes than this at once is a new list (another month, a filter), not
 * a row coming or going, so it is shown without animation.
 */
export const MAX_ANIMATED_CHANGES = 3;

/**
 * Next display list for `items`, given what is on screen now. New keys enter,
 * missing keys stay in place as exiting rows (after the row that preceded them)
 * until they have folded away. A first load or a wholesale change rests at once.
 */
export function mergePresence<T>(shown: ReadonlyArray<PresenceEntry<T>>, items: ReadonlyArray<T>, keyOf: (item: T) => string): PresenceEntry<T>[] {
  const live = shown.filter((entry) => entry.presence !== 'exit');
  const liveByKey = new Map(live.map((entry) => [entry.key, entry]));
  const nextKeys = new Set(items.map(keyOf));
  const added = items.filter((item) => !liveByKey.has(keyOf(item))).length;
  const removed = live.filter((entry) => !nextKeys.has(entry.key));
  const kept = live.length - removed.length;

  if (live.length === 0 || kept === 0 || added + removed.length > MAX_ANIMATED_CHANGES) {
    return items.map((item) => ({ key: keyOf(item), item }));
  }

  // Rows already folding away keep folding; newly missing rows start to.
  const exiting = shown.filter((entry) => !nextKeys.has(entry.key)).map((entry) => ({ ...entry, presence: 'exit' as const }));
  const anchorOf = new Map<string, string | null>();
  let anchor: string | null = null;
  for (const entry of shown) {
    if (nextKeys.has(entry.key)) anchor = entry.key;
    else anchorOf.set(entry.key, anchor);
  }
  const after = (key: string | null) => exiting.filter((entry) => anchorOf.get(entry.key) === key);

  const merged: PresenceEntry<T>[] = [...after(null)];
  for (const item of items) {
    const key = keyOf(item);
    const previous = liveByKey.get(key);
    merged.push({ key, item, presence: previous ? previous.presence : 'enter' });
    merged.push(...after(key));
  }
  return merged;
}

/**
 * Rows of a list with enter/exit states, so a row added or removed in place
 * grows in or folds away and the list closes up instead of jumping. Render
 * each entry with `presenceProps` (table rows) or `PresenceItem` (list items).
 */
export function useListPresence<T>(items: ReadonlyArray<T>, keyOf: (item: T) => string): PresenceEntry<T>[] {
  const [source, setSource] = useState(items);
  const [shown, setShown] = useState<PresenceEntry<T>[]>(() => items.map((item) => ({ key: keyOf(item), item })));
  // Bumped only when a row starts animating, so re-renders do not restart the settle timer.
  const [generation, setGeneration] = useState(0);

  if (items !== source) {
    const next = mergePresence(shown, items, keyOf);
    setSource(items);
    setShown(next);
    const reordered = next.length !== shown.length || next.some((entry, index) => entry.key !== shown[index].key);
    if (reordered && next.some((entry) => entry.presence)) setGeneration((value) => value + 1);
  }

  const animating = shown.some((entry) => entry.presence);
  useEffect(() => {
    if (!animating) return;
    const timer = window.setTimeout(() => {
      setShown((current) => current.filter((entry) => entry.presence !== 'exit').map(({ key, item }) => ({ key, item })));
    }, DIALOG_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [animating, generation]);

  return shown;
}

/** Attributes for an animating row; an exiting row is hidden from assistive tech (and from the pointer, in globals.css). */
export function presenceProps(presence: Presence | undefined) {
  return presence ? { 'data-presence': presence, 'aria-hidden': presence === 'exit' || undefined } : {};
}

/**
 * Table cell content wrapper. At rest both layers are `display: contents`, so
 * cells lay out and truncate exactly as before; while the row animates they
 * become the grid that folds the content. The tree never changes shape, so
 * nothing inside remounts when the row settles.
 */
export function PresenceCell({ children }: { children: ReactNode }) {
  return (
    <div className="presence-cell">
      <div>{children}</div>
    </div>
  );
}

export interface PresenceItemProps {
  presence?: Presence;
  /** Element for the row; `li` by default. */
  as?: 'li' | 'div';
  /** Classes for the row's content box (padding, flex layout). */
  className?: string;
  children: ReactNode;
}

/** One list row that grows in and folds away; its padding sits inside the fold. */
export function PresenceItem({ presence, as = 'li', className, children }: PresenceItemProps) {
  return createElement(
    as,
    { className: 'presence', ...presenceProps(presence) },
    <div>
      <div className={cn(className)}>{children}</div>
    </div>,
  );
}
