import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TappableSurface, type TappableCardProps } from './Tappable';

type CardPadding = 'none' | 'sm' | 'md' | 'lg';
type CardTone = 'default' | 'primary' | 'info' | 'success' | 'warning' | 'orange' | 'muted';

const paddingClasses: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3 sm:p-4',
  md: 'p-4 sm:p-5',
  lg: 'p-5 sm:p-6',
};

// Tinted tones stay quiet: a pale fill and a matching hairline, never a
// coloured block. Colour carries meaning; it should not be a section label.
const toneClasses: Record<CardTone, string> = {
  default: 'border-gray-200 bg-surface shadow-card',
  primary: 'border-primary-200 bg-surface shadow-card',
  info: 'border-primary-100 bg-primary-50/50',
  success: 'border-success-100 bg-success-50/50',
  warning: 'border-warning-100 bg-warning-50/50',
  orange: 'border-orange-100 bg-orange-50/50',
  muted: 'border-gray-200 bg-gray-50',
};

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick'>, TappableCardProps {
  /** Ignored on a tappable card, which is a link or a button. */
  as?: ElementType;
  /** Accessible name of a tappable card whose content does not name where it goes. */
  label?: string;
  /** Hide the corner chevron of a tappable card that already shows where it leads. */
  chevron?: boolean;
  padding?: CardPadding;
  tone?: CardTone;
  /** Dashed border, for placeholders and optional areas. */
  dashed?: boolean;
  children: ReactNode;
}

/**
 * The single surface primitive: white rounded panel with a hairline border.
 * Pass `href` or `onClick` and the whole card becomes one tap target with the
 * shared lift, press and focus ring; never wrap a Card in a button by hand.
 */
export function Card({
  as: Component = 'div',
  padding = 'md',
  tone = 'default',
  dashed = false,
  className,
  children,
  href,
  onClick,
  label,
  chevron = true,
  ...rest
}: CardProps) {
  if (href || onClick) {
    return (
      <TappableSurface
        href={href}
        onClick={onClick}
        label={label}
        chevron={chevron}
        className={cn('min-w-0 rounded-2xl border', toneClasses[tone], paddingClasses[padding], chevron && 'pr-8 sm:pr-9', className)}
      >
        {children}
      </TappableSurface>
    );
  }
  return (
    <Component
      className={cn(
        'min-w-0 rounded-2xl border',
        toneClasses[tone],
        dashed && 'border-dashed shadow-none',
        paddingClasses[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}

export interface SectionHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  iconClassName?: string;
  action?: ReactNode;
  /** Small chip rendered next to the title (a count, a status). */
  badge?: ReactNode;
  as?: 'h2' | 'h3';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const headingSize = {
  sm: 'text-sm font-semibold text-gray-950',
  md: 'text-base font-semibold text-gray-950',
  lg: 'text-lg font-bold tracking-tight text-gray-950 sm:text-xl',
};

/** Title + description row used at the top of cards and page sections. */
export function SectionHeading({
  title,
  description,
  icon,
  iconClassName,
  action,
  badge,
  as: Heading = 'h2',
  size = 'md',
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600',
              iconClassName,
            )}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Heading className={cn('break-words', headingSize[size])}>{title}</Heading>
            {badge}
          </div>
          {description && <p className="mt-1 text-sm leading-5 text-gray-500">{description}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{action}</div>}
    </div>
  );
}

/** Card whose header/body are separated by a divider. */
export function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('border-b border-gray-100 px-4 py-4 sm:px-5', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-4 sm:p-5', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('border-t border-gray-100 px-4 py-4 sm:px-5', className)} {...rest}>
      {children}
    </div>
  );
}
