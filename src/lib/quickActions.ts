'use client';

import { useEffect } from 'react';
import type { PendingQuickAction } from '@/lib/commands';

/** A request older than this is forgotten: the page it was meant for never opened. */
const PENDING_TTL_MS = 10_000;
const EVENT = 'game-club-finance:quick-action';

let pending: { action: PendingQuickAction; at: number } | null = null;

/**
 * Asks the page about to open (or already open) to show one of its forms.
 * Kept in memory, not in the URL: a reload or a shared link must not reopen a
 * form nobody asked for.
 */
export function requestQuickAction(action: PendingQuickAction, now = Date.now()) {
  pending = { action, at: now };
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

/** True once for a fresh request of `action`; the request is then spent. */
export function consumeQuickAction(action: PendingQuickAction, now = Date.now()): boolean {
  if (!pending || pending.action !== action) return false;
  const fresh = now - pending.at <= PENDING_TTL_MS;
  pending = null;
  return fresh;
}

/**
 * Runs `open` when this page is reached through the quick action, whether it
 * mounts for it or is already on screen. `enabled` waits for the page to be
 * ready (loaded, and the member allowed to use the form).
 */
export function useQuickAction(action: PendingQuickAction, open: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    // Opened a tick later, after the page's own mount effects: several pages
    // close their forms when the club is (first) set, and would close this one.
    const check = () => { if (consumeQuickAction(action)) window.setTimeout(open, 0); };
    check();
    window.addEventListener(EVENT, check);
    return () => window.removeEventListener(EVENT, check);
    // `open` is read fresh on every run; re-subscribing on each render would be noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, enabled]);
}
