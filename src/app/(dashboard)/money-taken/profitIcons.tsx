import {
  Banknote,
  CircleHelp,
  CreditCard,
  DollarSign,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { MONEY_SOURCE_ICONS, SIDE_ICONS } from '@/components/sideIcons';
import type { OwnerWithdrawalPaymentMethod, OwnerWithdrawalSource } from '@/types';

/** The app-wide business icons (sideIcons): the club's PCs and the bar's bag. */
export const SOURCE_ICONS: Record<OwnerWithdrawalSource, LucideIcon> = MONEY_SOURCE_ICONS;

/** Icon tint per profit source: Game Club is the brand colour, Bar is orange. */
export const SOURCE_TINTS: Record<OwnerWithdrawalSource, { bubble: string; bar: string; dot: string }> = {
  game_club: { bubble: 'bg-primary-50 text-primary-600', bar: 'bg-primary-500', dot: 'bg-primary-500' },
  bar: { bubble: 'bg-orange-50 text-orange-600', bar: 'bg-orange-500', dot: 'bg-orange-500' },
};

export const METHOD_ICONS: Record<OwnerWithdrawalPaymentMethod | 'unassigned' | 'usd', LucideIcon> = {
  cash: Banknote,
  terminal: CreditCard,
  card: WalletCards,
  playstation: SIDE_ICONS.playstation,
  usd: DollarSign,
  unassigned: CircleHelp,
};
