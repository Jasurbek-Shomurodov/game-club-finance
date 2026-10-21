'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/** Exit length shared by dialogs, sheets and pickers; matches `duration-[250ms]` below. */
export const DIALOG_EXIT_MS = 250;

/**
 * Enter/exit state for an overlay. `mounted` keeps it in the DOM until the
 * exit transition has played; `visible` is the CSS state to transition to.
 * The closed state paints for one frame before `visible` flips, so the
 * entrance animates instead of appearing at its end state.
 */
export function usePresence(open: boolean, exitMs = DIALOG_EXIT_MS) {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) {
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setEntered(true));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    const timer = window.setTimeout(() => {
      setMounted(false);
      setEntered(false);
    }, exitMs);
    return () => window.clearTimeout(timer);
  }, [exitMs, open]);

  return { mounted: open || mounted, visible: open && entered };
}

/**
 * Returns `value` while open and the last open value while closing, so a
 * dialog whose content comes from state that clears on close (a selected
 * row, confirm options) keeps showing it during the exit animation.
 */
export function useHeldWhileClosing<T extends object>(open: boolean, value: T): T {
  const [held, setHeld] = useState(value);
  // Shallow compare: callers pass a fresh object of props on every render.
  if (open && !shallowEqual(held, value)) setHeld(value);
  return open ? value : held;
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as Array<keyof T>;
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

const MOTION = 'duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none';

/**
 * The one scrim behind every dialog, sheet, drawer and picker. Plain black on
 * purpose: the gray scale flips to near-white in dark mode, so `gray-950`
 * would lighten the page instead of dimming it.
 */
export const SCRIM_CLASS = 'bg-black/40 backdrop-blur-[2px]';

/** Dimmed, blurred backdrop that fades with the dialog. */
export function backdropMotion(visible: boolean) {
  return cn('transition-opacity', MOTION, visible ? 'opacity-100' : 'opacity-0');
}

/** Bottom sheet that slides up on phones; a card that fades and scales in from `sm` up. */
export function sheetMotion(visible: boolean) {
  return cn(
    'transition-[transform,opacity]',
    MOTION,
    visible
      ? 'translate-y-0 sm:scale-100 sm:opacity-100'
      : 'translate-y-full sm:translate-y-3 sm:scale-95 sm:opacity-0',
  );
}

/** Side panel that slides in from the given edge. */
export function slideMotion(visible: boolean, side: 'left' | 'right') {
  return cn(
    'transition-transform',
    MOTION,
    visible ? 'translate-x-0' : side === 'left' ? '-translate-x-full' : 'translate-x-full',
  );
}
