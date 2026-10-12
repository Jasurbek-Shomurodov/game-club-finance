'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface TopBarSlot {
  /** Where the open page's title goes; null until the top bar has mounted. */
  title: HTMLElement | null;
  /** Where the open page's actions go; null when the bar has no room for them (phones, narrow windows). */
  actions: HTMLElement | null;
  titleRef: (element: HTMLElement | null) => void;
  actionsRef: (element: HTMLElement | null) => void;
}

const TopBarSlotContext = createContext<TopBarSlot | null>(null);

/** Lets the shell's top bar lend its title and action areas to the page below it. */
export function TopBarSlotProvider({ children }: { children: ReactNode }) {
  const [title, titleRef] = useState<HTMLElement | null>(null);
  const [actions, actionsRef] = useState<HTMLElement | null>(null);
  const slot = useMemo(() => ({ title, actions, titleRef, actionsRef }), [title, actions]);
  return <TopBarSlotContext.Provider value={slot}>{children}</TopBarSlotContext.Provider>;
}

/** The top bar's areas, or null outside the dashboard shell, where a page keeps its own heading. */
export function useTopBarSlot() {
  return useContext(TopBarSlotContext);
}
