'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible group name. */
  label: string;
  /**
   * solid: bordered buttons, selected is filled primary (payment methods, sources).
   * soft: grey track with a raised white pill (tabs).
   * chips: pill-shaped filter chips that wrap or scroll.
   * tabs: plain text with an underline under the selected one (page tabs beside the title).
   */
  variant?: 'solid' | 'soft' | 'chips' | 'tabs';
  size?: 'sm' | 'md';
  /** Grid columns for solid/soft; defaults to one column per option. Pass 'auto' to control columns via className. */
  columns?: number | 'auto';
  disabled?: boolean;
  className?: string;
}

/** Mutually-exclusive choice rendered as buttons. Replaces ad-hoc toggle groups. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  variant = 'solid',
  size = 'md',
  columns,
  disabled = false,
  className,
}: SegmentedControlProps<T>) {
  const isChips = variant === 'chips';
  const isTabs = variant === 'tabs';
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const enabledIndexes = options.flatMap((option, index) => (disabled || option.disabled ? [] : [index]));
  const selectedIndex = options.findIndex((option) => option.value === value);
  // Roving tab stop: the selected option (or the first enabled one) is the only Tab target.
  const tabStopIndex = enabledIndexes.includes(selectedIndex) ? selectedIndex : enabledIndexes[0];

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key) || enabledIndexes.length === 0) return;
    event.preventDefault();
    const position = enabledIndexes.indexOf(index);
    let next: number;
    if (event.key === 'Home') next = enabledIndexes[0];
    else if (event.key === 'End') next = enabledIndexes[enabledIndexes.length - 1];
    else {
      const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
      next = enabledIndexes[(position + step + enabledIndexes.length) % enabledIndexes.length];
    }
    buttonsRef.current[next]?.focus();
    onChange(options[next].value);
  }
  const height = size === 'sm' ? 'min-h-9 text-xs' : 'min-h-11 text-sm';

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn(
        isChips
          ? 'flex flex-wrap gap-2'
          : isTabs
            ? 'flex flex-wrap items-center gap-x-3 gap-y-1'
            : cn('grid', variant === 'soft' ? 'gap-1 rounded-xl bg-gray-100 p-1' : 'gap-2'),
        className,
      )}
      style={!isChips && !isTabs && columns !== 'auto' ? { gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttonsRef.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === tabStopIndex ? 0 : -1}
            onKeyDown={(event) => handleKeyDown(event, index)}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50',
              isChips
                ? cn('whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px]', selected
                  ? 'border-gray-950 bg-gray-950 text-gray-50'
                  : 'border-gray-200 bg-surface text-gray-600 hover:border-gray-300 hover:text-gray-900')
                : isTabs
                  ? cn('whitespace-nowrap border-b-2 px-1 py-1 text-sm', selected
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-900')
                  : variant === 'soft'
                  // Raised white pill: the selected tab is the only one with a surface.
                  ? cn('rounded-[10px] px-3', height, selected
                    ? 'bg-surface font-semibold text-gray-950 shadow-sm'
                    : 'text-gray-500 hover:text-gray-900')
                  : cn('rounded-xl border px-2', height, selected
                    ? 'border-primary-600 bg-primary-600 font-semibold text-on-accent shadow-sm'
                    : 'border-gray-200 bg-surface text-gray-700 hover:border-gray-300 hover:bg-gray-50'),
            )}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
