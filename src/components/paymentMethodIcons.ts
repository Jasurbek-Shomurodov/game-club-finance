import { Banknote, CircleDollarSign, CreditCard, Gamepad2, WalletCards, type LucideIcon } from 'lucide-react';
import type { ExpensePaymentMethod } from '@/types';

/** One icon per payment method, shared by every form and list that names a method. */
export const PAYMENT_METHOD_ICONS: Record<ExpensePaymentMethod, LucideIcon> = {
  cash: Banknote,
  terminal: CreditCard,
  card: WalletCards,
  playstation: Gamepad2,
  usd: CircleDollarSign,
};
