import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DisclosureProps {
  /** Always-visible toggle text. */
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * Native `<details>` toggle with a quiet pill summary and a chevron that turns
 * when open. Use for optional help text or collapsed secondary lists.
 */
export function Disclosure({ summary, children, defaultOpen, className }: DisclosureProps) {
  return (
    <details className={cn('group', className)} open={defaultOpen}>
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-[13px] font-semibold text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 [&::-webkit-details-marker]:hidden [&>svg]:transition-transform group-open:[&>svg]:rotate-90">
        <ChevronRight size={16} aria-hidden="true" />
        {summary}
      </summary>
      {children}
    </details>
  );
}
