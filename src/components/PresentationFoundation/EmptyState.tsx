import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Compact variant for inside cards and tables. */
  compact?: boolean;
  /** Dashed bordered variant for "nothing here yet" placeholders. */
  bordered?: boolean;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, compact = false, bordered = false, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'px-4 py-16',
        bordered && 'rounded-2xl border border-dashed border-gray-300 bg-surface',
        className,
      )}
    >
      {Icon && (
        <div className={cn('mb-3 rounded-2xl bg-gray-100 text-gray-500', compact ? 'p-3' : 'p-4')}>
          <Icon size={compact ? 22 : 30} />
        </div>
      )}
      <h3 className={cn('font-semibold text-gray-700', compact ? 'text-sm' : 'text-lg')}>{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
