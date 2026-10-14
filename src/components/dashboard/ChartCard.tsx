'use client';

import { useId, type ReactNode } from 'react';
import { Card, EmptyState } from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';

/**
 * Chart palette: the Tailwind tokens as CSS colours, so Recharts (which cannot
 * read Tailwind classes) stays on the design system and follows the theme.
 */
const token = (name: string, alpha?: number) => `rgb(var(--c-${name})${alpha === undefined ? '' : ` / ${alpha}`})`;

export const chartColors = {
  primary: token('primary-600'),
  success: token('success-500'),
  danger: token('danger-500'),
  warning: token('warning-500'),
  purple: token('purple-500'),
  orange: token('orange-500'),
  gray: token('gray-400'),
  axis: token('gray-500'),
  grid: token('gray-500', 0.25),
  cursor: token('gray-500', 0.12),
} as const;

/** Themed Recharts tooltip box; spread onto every `<Tooltip>` so it is not white in dark mode. */
export const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: token('surface'),
    border: `1px solid ${token('gray-200')}`,
    borderRadius: 8,
    boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)',
    fontSize: 12,
  },
  labelStyle: { color: token('gray-950'), fontWeight: 600, marginBottom: 4 },
  itemStyle: { padding: '1px 0' },
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
