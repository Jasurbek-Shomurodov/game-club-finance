'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './Spinner';

type IconButtonVariant = 'outline' | 'ghost' | 'soft' | 'danger';
type IconButtonSize = 'sm' | 'md';

const variantClasses: Record<IconButtonVariant, string> = {
  outline: 'border border-gray-200 bg-surface text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50 hover:text-gray-950',
  ghost: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
  soft: 'bg-primary-50 text-primary-700 hover:bg-primary-100',
  danger: 'text-gray-400 hover:bg-danger-50 hover:text-danger-600 focus-visible:ring-danger-500',
};

const sizeClasses: Record<IconButtonSize, string> = {
  // 32px visually; on phones an invisible ring widens the hit area to 40px.
  sm: "relative h-8 w-8 max-sm:before:absolute max-sm:before:-inset-1 max-sm:before:content-['']",
  md: 'h-10 w-10',
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name. Icon-only controls must always describe what they do. */
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'outline', size = 'md', loading = false, className, disabled, type = 'button', ...rest },
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
        'inline-flex shrink-0 items-center justify-center rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} /> : icon}
    </button>
  );
});
