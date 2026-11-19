import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Makes a surface open more detail: a link with `href`, a button with `onClick`, otherwise a plain box. */
export interface TappableCardProps {
  /** Where tapping goes (a page with the records behind the figure, built with `@/lib/detailLinks`). */
  href?: string;
  /** Tapping opens something in place, such as a details sheet. */
  onClick?: () => void;
}

/**
 * Hover lift, press dip (`.tappable`, globals.css) and the focus ring every
 * tappable surface shares. `group` lets children react to the hover.
 */
export const tappableClassName =
  'tappable group relative block w-full text-left hover:border-gray-300 hover:shadow-pop ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2';

/**
 * The shell of anything a person can tap for more: renders a link, a button
 * or a plain `div` from the same classes, and draws the corner chevron that
 * says "this opens". Cards, metric cards and stat tiles are all built on it.
 */
export function TappableSurface({ href, onClick, className, chevron = true, label, children }: TappableCardProps & {
  className?: string;
  /** Corner chevron on a tappable surface; turn off when the content already shows one. */
  chevron?: boolean;
  /** Accessible name when the content does not name the destination. */
  label?: string;
  children: ReactNode;
}) {
  const mark = chevron ? (
    <ChevronRight
      size={15}
      aria-hidden="true"
      className="absolute right-3 top-3.5 text-gray-300 transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-primary-600 sm:top-4"
    />
  ) : null;
  if (href) {
    return <Link href={href} aria-label={label} className={cn(className, tappableClassName)}>{children}{mark}</Link>;
  }
  if (onClick) {
    return <button type="button" onClick={onClick} aria-label={label} className={cn(className, tappableClassName)}>{children}{mark}</button>;
  }
  return <div className={className}>{children}</div>;
}
