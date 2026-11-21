import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface NavTabBase {
  /** A lucide icon component; drawn at 20px, a little heavier when active. */
  icon: ElementType;
  label: ReactNode;
  /** The current screen: accent colour, and `aria-current="page"` on a link. */
  active?: boolean;
  /** A count on the icon's corner (something behind this tab is waiting). */
  badge?: number;
  /** Placement only. */
  className?: string;
}

type NavTabLinkProps = NavTabBase
  & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children' | 'className' | 'aria-current'>
  & { href: string; prefetch?: boolean };

type NavTabButtonProps = NavTabBase
  & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'type'>
  & { href?: undefined };

export type NavTabProps = NavTabLinkProps | NavTabButtonProps;

const navTabClassName =
  'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs leading-tight transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500';

/**
 * One item of a bottom tab bar: the icon over a 12px label, 56px tall, sharing
 * the bar's width with its neighbours. With `href` it is a link to a screen;
 * without, a button that opens something (pass `aria-expanded`/`aria-controls`).
 */
export function NavTab(props: NavTabProps) {
  const { icon: Icon, label, active = false, badge = 0, className, ...rest } = props;
  const classes = cn(navTabClassName, active ? 'font-semibold text-primary-700' : 'font-medium text-gray-500 hover:text-gray-950', className);
  const content = (
    <>
      <span className="relative">
        <Icon size={20} strokeWidth={active ? 2.25 : 2} aria-hidden="true" />
        {badge > 0 && (
          <span className="absolute -right-3 -top-1.5 min-w-4 rounded-full bg-warning-50 px-1 text-center text-xs font-semibold leading-4 text-warning-700 ring-1 ring-surface">
            {badge}
          </span>
        )}
      </span>
      <span className="max-w-full truncate">{label}</span>
    </>
  );

  if (rest.href !== undefined) {
    return (
      <Link {...rest} aria-current={active ? 'page' : undefined} className={classes}>
        {content}
      </Link>
    );
  }
  return (
    <button {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)} type="button" className={classes}>
      {content}
    </button>
  );
}
