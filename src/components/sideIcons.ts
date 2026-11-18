import { Gamepad2, Monitor, ShoppingBag, type LucideIcon } from 'lucide-react';

/**
 * One icon per business everywhere in the app (and drawn the same way in the
 * Telegram report): the game club is its PCs, PlayStation is the gamepad, and
 * the bar is the shopping bag.
 */
export const SIDE_ICONS = {
  gameClub: Monitor,
  playstation: Gamepad2,
  bar: ShoppingBag,
} as const satisfies Record<string, LucideIcon>;

/** The same icons keyed by the stored money source. */
export const MONEY_SOURCE_ICONS: Record<'game_club' | 'bar', LucideIcon> = {
  game_club: SIDE_ICONS.gameClub,
  bar: SIDE_ICONS.bar,
};
