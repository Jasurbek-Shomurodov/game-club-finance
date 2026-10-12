'use client';

import { useId, type ReactNode } from 'react';
import { Card, EmptyState } from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';

/**
 * Chart palette: the same hexes as the Tailwind tokens so Recharts (which
 * cannot read Tailwind classes) stays on the design system's colours.
 */
export const chartColors = {
  primary: '#2f52e0',
  success: '#12a36f',
  danger: '#e0453f',
  warning: '#e39a1e',
  purple: '#7c5cf2',
  orange: '#f07a2b',
  gray: '#98a2b3',
  axis: '#667085',
  grid: 'rgba(102, 112, 133, 0.25)',
  cursor: 'rgba(102, 112, 133, 0.12)',
} as const;

/** Card wrapper shared by every dashboard chart; the section is named by its heading. */
export function ChartCard({ title, description, action, className, children }: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <Card as="section" className={cn('flex flex-col', className)} aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <h2 id={headingId} className="break-words text-sm font-semibold text-gray-950">{title}</h2>
          {description && <p className="mt-0.5 text-xs leading-5 text-gray-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function ChartEmpty({ title, className }: { title: string; className?: string }) {
  return <EmptyState compact bordered title={title} className={cn('min-h-56 border-gray-200', className)} />;
}

// App locale -> BCP 47 tag for number formatting (matches src/lib/formatters.ts).
const NUMBER_LOCALES: Record<string, string> = {
  en: 'en-GB',
  ru: 'ru-RU',
  uz: 'uz-Latn-UZ',
};

const compactFormatters = new Map<string, Intl.NumberFormat>();

/** Compact axis tick label ("1.2M", "1,2 млн", ...) in the selected app language. */
export function formatAxis(value: number, locale: string): string {
  const tag = NUMBER_LOCALES[locale] ?? locale;
  let formatter = compactFormatters.get(tag);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(tag, { notation: 'compact', maximumFractionDigits: 1 });
    } catch {
      formatter = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
    }
    compactFormatters.set(tag, formatter);
  }
  return formatter.format(value);
}
