import {
  ArrowRightLeft,
  BadgePercent,
  Banknote,
  Building2,
  CircleDashed,
  Coffee,
  Cpu,
  HandCoins,
  Landmark,
  Megaphone,
  Package,
  PencilLine,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  UserRound,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * One icon per expense category, so a row says where the money went before
 * its text is read. Unknown or retired categories use the `other` icon.
 */
export const EXPENSE_CATEGORY_ICONS: Record<string, LucideIcon> = {
  rent: Building2,
  salary: UserRound,
  electricity: Zap,
  internet: Wifi,
  repair: Wrench,
  cleaning: Sparkles,
  food_drinks: Coffee,
  marketing: Megaphone,
  equipment: Cpu,
  tax: Landmark,
  correction: PencilLine,
  discount: BadgePercent,
  supplies: Package,
  investments: TrendingUp,
  shortage: TriangleAlert,
  other: CircleDashed,
};

/** Icons for the money that comes in or moves, beside the expense ones. */
export const MONEY_MOVE_ICONS = {
  income: Banknote,
  debtPayment: HandCoins,
  exchange: ArrowRightLeft,
} as const satisfies Record<string, LucideIcon>;
