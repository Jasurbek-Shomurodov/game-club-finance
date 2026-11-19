import { cn } from '@/lib/utils';
import { EXPENSE_CATEGORY_ICONS, MONEY_MOVE_ICONS } from '@/components/expenseCategoryIcons';

export type CategoryIconTone = 'expense' | 'bar' | 'income' | 'debt' | 'move';

const TONES: Record<CategoryIconTone, string> = {
  expense: 'bg-danger-50 text-danger-600',
  // Paid from bar money: the bar's orange, so the paying side shows too.
  bar: 'bg-orange-50 text-orange-600',
  income: 'bg-success-50 text-success-600',
  debt: 'bg-primary-50 text-primary-600',
  move: 'bg-gray-100 text-gray-600',
};

const SIZES = {
  sm: { box: 'h-7 w-7 rounded-lg', icon: 14 },
  md: { box: 'h-9 w-9 rounded-xl', icon: 17 },
} as const;

/**
 * A tinted tile with the expense category's icon (or how money came in or
 * moved), at the start of a row so it says where the money went before the
 * text is read. Decorative: the row's text names the category.
 */
export function CategoryIcon({ category, kind, tone, size = 'md', className }: {
  /** An expense category; ignored when `kind` names an income or a move. */
  category?: string | null;
  kind?: 'expense' | 'income' | 'debtPayment' | 'exchange';
  /** Defaults from `kind`: expenses red, income green, debt payments blue, exchanges grey. */
  tone?: CategoryIconTone;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const Icon = kind === 'income' ? MONEY_MOVE_ICONS.income
    : kind === 'debtPayment' ? MONEY_MOVE_ICONS.debtPayment
      : kind === 'exchange' ? MONEY_MOVE_ICONS.exchange
        : EXPENSE_CATEGORY_ICONS[category ?? 'other'] ?? EXPENSE_CATEGORY_ICONS.other;
  const resolvedTone = tone ?? (kind === 'income' ? 'income' : kind === 'debtPayment' ? 'debt' : kind === 'exchange' ? 'move' : 'expense');
  const { box, icon } = SIZES[size];
  return (
    <span aria-hidden="true" className={cn('flex shrink-0 items-center justify-center', box, TONES[resolvedTone], className)}>
      <Icon size={icon} strokeWidth={2.1} />
    </span>
  );
}
