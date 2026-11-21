import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toneClasses } from './tone';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Compact variant for inside cards and tables. */
  compact?: boolean;
  /** Dashed bordered variant for "nothing here yet" placeholders. */
  bordered?: boolean;
  /** Heading level of the title; `p` when the empty state sits under a heading of its own. */
  as?: 'h1' | 'h2' | 'h3' | 'p';
  /** `warning` tints the icon tile when the emptiness needs attention. */
  tone?: 'neutral' | 'warning';
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, compact = false, bordered = false, as: Title = 'h3', tone = 'neutral', className }: EmptyStateProps) {
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
        <div className={cn('mb-3 rounded-2xl', tone === 'warning' ? toneClasses.warning.chip : 'bg-gray-100 text-gray-500', compact ? 'p-3' : 'p-4')}>
          <Icon size={compact ? 22 : 30} />
        </div>
      )}
      <Title className={cn('font-semibold text-gray-700', compact ? 'text-sm' : 'text-lg')}>{title}</Title>
      {description && <p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
