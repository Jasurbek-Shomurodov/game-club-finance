'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './Spinner';

type IconButtonVariant = 'outline' | 'ghost' | 'soft' | 'danger' | 'primary' | 'success';
type IconButtonSize = 'sm' | 'md' | 'lg';
type IconButtonShape = 'square' | 'round';

const variantClasses: Record<IconButtonVariant, string> = {
  outline: 'border border-gray-200 bg-surface text-gray-700 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-950',
  ghost: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
  soft: 'bg-primary-50 text-primary-700 hover:bg-primary-100',
  danger: 'text-gray-500 hover:bg-danger-50 hover:text-danger-600 focus-visible:ring-danger-500',
  // Filled, like the `Button` variants of the same name.
  primary: 'bg-primary-600 text-on-accent hover:bg-primary-700 dark:hover:bg-primary-400',
  success: 'bg-success-600 text-on-accent hover:bg-success-700 focus-visible:ring-success-500',
};

/** The resting shadow of the bordered and filled variants; a round button floats instead. */
const variantShadow: Partial<Record<IconButtonVariant, string>> = { outline: 'shadow-sm', primary: 'shadow-sm', success: 'shadow-sm' };

const shapeClasses: Record<IconButtonShape, string> = {
  square: 'rounded-xl',
  // The one floating action of a bar (the bottom navigation's "+"): a lifted
  // circle that dips when pressed, with a hit area 6px wider than it looks.
  round: "relative rounded-full shadow-pop active:scale-95 motion-reduce:active:scale-100 focus-visible:ring-offset-2 before:absolute before:-inset-1.5 before:content-['']",
};

const sizeClasses: Record<IconButtonSize, string> = {
  // 32px visually; on phones an invisible ring widens the hit area to 40px.
  sm: "relative h-8 w-8 max-sm:before:absolute max-sm:before:-inset-1 max-sm:before:content-['']",
  md: 'h-10 w-10',
  // 44px: the height of a `Button` of size `md`, for an icon action beside one.
  lg: 'h-11 w-11',
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name. Icon-only controls must always describe what they do. */
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** `round` is the floating circular action (use with `variant="primary"`, `size="lg"`); `square` is every other icon button. */
  shape?: IconButtonShape;
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'outline', size = 'md', shape = 'square', loading = false, className, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40',
        variantClasses[variant],
        shape === 'square' && variantShadow[variant],
        shapeClasses[shape],
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} /> : icon}
    </button>
  );
});
