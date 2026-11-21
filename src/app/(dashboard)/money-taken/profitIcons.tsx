import {
  Banknote,
  CircleHelp,
  CreditCard,
  DollarSign,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { MONEY_SOURCE_ICONS, SIDE_ICONS } from '@/components/sideIcons';
import { toneClasses, type Tone } from '@/components/PresentationFoundation';
import type { OwnerWithdrawalPaymentMethod, OwnerWithdrawalSource } from '@/types';

/** The app-wide business icons (sideIcons): the club's PCs and the bar's bag. */
export const SOURCE_ICONS: Record<OwnerWithdrawalSource, LucideIcon> = MONEY_SOURCE_ICONS;

/** Tone per profit source (tone.ts): Game Club is the brand colour, Bar is orange. */
export const SOURCE_TONES: Record<OwnerWithdrawalSource, Tone> = { game_club: 'primary', bar: 'bar' };

/** The source's tone as classes for a meter fill (`bar`) and a legend dot (`dot`). */
export const SOURCE_TINTS: Record<OwnerWithdrawalSource, { bar: string; dot: string }> = {
  game_club: { bar: toneClasses.primary.solid, dot: toneClasses.primary.solid },
  bar: { bar: toneClasses.bar.solid, dot: toneClasses.bar.solid },
};

export const METHOD_ICONS: Record<OwnerWithdrawalPaymentMethod | 'unassigned' | 'usd', LucideIcon> = {
  cash: Banknote,
  terminal: CreditCard,
  card: WalletCards,
  playstation: SIDE_ICONS.playstation,
  usd: DollarSign,
  unassigned: CircleHelp,
};
