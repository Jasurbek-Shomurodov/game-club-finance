'use client';

import type { ReactNode } from 'react';
import { ArrowDownRight, Wallet, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  AmountCard,
  HelpButton,
  MetricCard,
  toneForAmount,
  type MetricTone,
} from '@/components/PresentationFoundation';
import type { SourceIndicators } from '@/lib/calculations/financialAnalysis';

export function Section({ id, title, description, icon: Icon, iconClassName, action, help, children }: {
  /** Anchor for in-page navigation. */
  id?: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  /** Control beside the heading, e.g. a grouping switch. */
  action?: ReactNode;
  /** Explanation behind a "?" beside the title. */
  help?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex items-center gap-1">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-950">
              {Icon && <Icon size={18} className={cn('shrink-0', iconClassName)} aria-hidden="true" />}
              {title}
            </h2>
            {help && <HelpButton title={title} body={help} className="-my-1.5" />}
          </div>
          {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Small ratio tile: icon, label, value, optional 0–100 meter and a caption. */
export function Indicator({ icon, iconClassName, label, value, helper, meter, tone = 'default', loading }: {
  icon: LucideIcon;
  iconClassName?: string;
  label: string;
  value: string;
  helper: string;
  meter?: number | null;
  tone?: MetricTone;
  loading: boolean;
}) {
  const meterColor = tone === 'danger' ? 'bg-danger-500' : tone === 'success' ? 'bg-success-500' : tone === 'warning' ? 'bg-warning-500' : 'bg-primary-600';
  return (
    <MetricCard
      loading={loading}
      icon={icon}
      iconClassName={iconClassName}
      label={label}
      value={value}
      tone={tone}
      helper={(
        <>
          {meter !== undefined && meter !== null && (
            <span className="mb-2 block h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
              <span className={cn('block h-full rounded-full', meterColor)} style={{ width: `${Math.min(100, Math.max(0, meter))}%` }} />
            </span>
          )}
          {helper}
        </>
      )}
    />
  );
}

/** Money in, spent and accounting profit for one side of the club; the two sides are never added together. */
export function SourceCards({ title, icon, iconClassName, incomeLabel, now, before, loading, currency, compare, description }: {
  title: string;
  icon: LucideIcon;
  /** The side's colour, so club and bar cards are told apart at a glance. */
  iconClassName: string;
  incomeLabel: string;
  now: SourceIndicators;
  before?: SourceIndicators;
  loading: boolean;
  currency: string;
  /** Leave out (with `before`) where there is no earlier period to compare with. */
  compare?: (now: number, before: number) => { value: number | null; label: string };
  description?: string;
}) {
  const t = useTranslations('financialAnalysis');
  return (
    <Section title={title} description={description} icon={icon} iconClassName={iconClassName}>
      <div className="grid gap-4 sm:grid-cols-3">
        <AmountCard
          loading={loading}
          currency={currency}
          label={incomeLabel}
          amount={now.income}
          icon={icon}
          iconClassName={iconClassName}
          tone="success"
          comparison={compare && before ? compare(now.income, before.income) : undefined}
        />
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('spent')}
          amount={now.spent}
          icon={ArrowDownRight}
          iconClassName={iconClassName}
          tone="danger"
          comparison={compare && before ? compare(now.spent, before.spent) : undefined}
          comparisonGoodWhen="down"
        />
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('profit')}
          amount={now.left}
          icon={Wallet}
          iconClassName={iconClassName}
          tone={toneForAmount(now.left)}
          comparison={compare && before ? compare(now.left, before.left) : undefined}
        />
      </div>
    </Section>
  );
}
