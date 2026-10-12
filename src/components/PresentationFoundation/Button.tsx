'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Link, { type LinkProps } from 'next/link';
import { cn } from '@/lib/utils';
import { Spinner } from './Spinner';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'dangerOutline'
  | 'success';

export type ButtonSize = 'sm' | 'md' | 'lg';

const baseClasses =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ' +
  'active:enabled:scale-[0.98] disabled:cursor-not-allowed';

// Disabled state is a distinct grey, not a faded copy of the enabled style,
// so a form's "nothing to save yet" is readable at a glance.
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-600 text-on-accent shadow-sm hover:bg-primary-700 dark:hover:bg-primary-400 disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none',
  secondary:
    'bg-gray-100 text-gray-800 hover:bg-gray-200 disabled:bg-gray-100 disabled:text-gray-400',
  outline:
    'border border-gray-200 bg-surface text-gray-800 shadow-sm hover:border-gray-300 hover:bg-gray-50 disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400 disabled:shadow-none',
  ghost:
    'text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:text-gray-400 disabled:hover:bg-transparent',
  danger:
    'bg-danger-600 text-on-accent shadow-sm hover:bg-danger-700 focus-visible:ring-danger-500 disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none',
  dangerOutline:
    'border border-danger-100 bg-surface text-danger-600 hover:border-danger-400 hover:bg-danger-50 focus-visible:ring-danger-500 disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400',
  success:
    'bg-success-600 text-on-accent shadow-sm hover:bg-success-700 focus-visible:ring-success-500 disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-[13px]',
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-12 px-5 text-base',
};

export function buttonClassName({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}) {
  return cn(baseClasses, variantClasses[variant], sizeClasses[size], fullWidth && 'w-full', className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the control and swaps the label for `loadingLabel` when provided. */
  loading?: boolean;
  loadingLabel?: ReactNode;
  icon?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
}

/**
 * Standard action button. Defaults to `type="button"` so it never submits a
 * form by accident; pass `type="submit"` explicitly for submit controls.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingLabel,
    icon,
    iconRight,
    fullWidth = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClassName({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} /> : icon}
      {loading && loadingLabel !== undefined ? loadingLabel : children}
      {!loading && iconRight}
    </button>
  );
});

export interface ButtonLinkProps extends Omit<LinkProps, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
}

/** A Next.js link styled exactly like `Button`. */
export function ButtonLink({
  variant = 'outline',
  size = 'md',
  icon,
  iconRight,
  fullWidth = false,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={buttonClassName({ variant, size, fullWidth, className })} {...rest}>
      {icon}
      {children}
      {iconRight}
    </Link>
  );
}
