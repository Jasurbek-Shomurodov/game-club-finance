import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'primary'
  | 'purple'
  | 'orange'
  | 'neutral'
  | 'outline';

const variantClasses: Record<BadgeVariant, string> = {
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  info: 'bg-primary-50 text-primary-700',
  primary: 'bg-primary-50 text-primary-700',
  purple: 'bg-purple-50 text-purple-700',
  orange: 'bg-orange-50 text-orange-700',
  neutral: 'bg-gray-100 text-gray-600',
  outline: 'border border-gray-200 bg-surface text-gray-600',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  children: ReactNode;
}

export function Badge({ variant = 'neutral', size = 'md', icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        variantClasses[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
