import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export type InlineAlertVariant = 'info' | 'success' | 'warning' | 'danger';

const variantStyles: Record<InlineAlertVariant, { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: 'border-primary-100 bg-primary-50/70 text-primary-900', icon: 'text-primary-600', Icon: Info },
  success: { box: 'border-success-100 bg-success-50/70 text-success-700', icon: 'text-success-600', Icon: CheckCircle2 },
  warning: { box: 'border-warning-100 bg-warning-50/70 text-warning-700', icon: 'text-warning-600', Icon: TriangleAlert },
  danger: { box: 'border-danger-100 bg-danger-50/70 text-danger-700', icon: 'text-danger-600', Icon: AlertCircle },
};

export interface InlineAlertProps {
  variant?: InlineAlertVariant;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** Hide the leading icon for very compact placements. */
  hideIcon?: boolean;
  /** `sm` tightens the padding, for an alert inside a form row or a card. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Inline status message. Danger/warning announce as `alert`, the rest as
 * `status`, so screen readers hear save results and failures.
 */
export function InlineAlert({ variant = 'info', title, children, action, hideIcon = false, size = 'md', className }: InlineAlertProps) {
  const { box, icon, Icon } = variantStyles[variant];
  const role = variant === 'danger' || variant === 'warning' ? 'alert' : 'status';

  return (
    <div role={role} className={cn('flex gap-3 rounded-xl border text-sm', size === 'sm' ? 'px-3 py-2' : 'px-4 py-3', box, className)}>
      {!hideIcon && <Icon size={17} className={cn('mt-0.5 shrink-0', icon)} aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title ? 'mt-0.5 text-[13px] leading-5 opacity-90' : 'font-medium')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
