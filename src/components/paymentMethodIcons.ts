import { Banknote, CreditCard, WalletCards, type LucideIcon } from 'lucide-react';
import type { EntryPaymentMethod } from '@/types';

/** One icon per payment method, shared by every form and list that names a method. */
export const PAYMENT_METHOD_ICONS: Record<EntryPaymentMethod, LucideIcon> = {
  cash: Banknote,
  terminal: CreditCard,
  card: WalletCards,
};
