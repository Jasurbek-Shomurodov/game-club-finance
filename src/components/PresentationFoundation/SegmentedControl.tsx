'use client';

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
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

interface IndicatorBox { x: number; y: number; width: number; height: number }

/**
 * Where the selected option sits inside the group, re-measured when the
 * selection or the group's size changes. The soft pill and the tab underline
 * are drawn once at this box and glide to the next one, instead of each
 * button painting its own selected state. Null until the first measure, so
 * server render and first paint fall back to the per-button style.
 */
function useIndicatorBox(enabled: boolean, selectedIndex: number, buttonsRef: RefObject<Array<HTMLButtonElement | null>>, group: HTMLDivElement | null) {
  const [box, setBox] = useState<IndicatorBox | null>(null);
  useLayoutEffect(() => {
    if (!enabled || !group) return;
    const buttons = buttonsRef.current ?? [];
    const measure = () => {
      const button = buttons[selectedIndex];
      if (!button) return setBox(null);
      const next = { x: button.offsetLeft, y: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight };
      setBox((prev) => (prev && prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    // Buttons too: a label can widen (fonts loading, a bolder selected label) inside a group whose own size holds.
    observer.observe(group);
    buttons.forEach((button) => button && observer.observe(button));
    return () => observer.disconnect();
  }, [buttonsRef, enabled, group, selectedIndex]);

  // The first measured position is placed without a transition, so the pill
  // does not fly in from the corner on load.
  const [animated, setAnimated] = useState(false);
  useLayoutEffect(() => {
    if (!box || animated) return;
    const frame = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(frame);
  }, [animated, box]);

  return enabled && box ? { ...box, animated } : null;
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
  const [group, setGroup] = useState<HTMLDivElement | null>(null);
  const enabledIndexes = options.flatMap((option, index) => (disabled || option.disabled ? [] : [index]));
  const selectedIndex = options.findIndex((option) => option.value === value);
  // Roving tab stop: the selected option (or the first enabled one) is the only Tab target.
  const tabStopIndex = enabledIndexes.includes(selectedIndex) ? selectedIndex : enabledIndexes[0];
  // Solid and chip buttons each have their own opaque surface, so a shared
  // indicator would vanish behind them mid-glide; only soft and tabs slide.
  const slides = variant === 'soft' || isTabs;
  const box = useIndicatorBox(slides, selectedIndex, buttonsRef, group);

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
      ref={setGroup}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn(
        slides && 'relative',
        isChips
          ? 'flex flex-wrap gap-2'
          : isTabs
            ? 'flex flex-wrap items-center gap-x-3 gap-y-1'
            : cn('grid', variant === 'soft' ? 'gap-1 rounded-xl bg-gray-100 p-1' : 'gap-2'),
        className,
      )}
      style={!isChips && !isTabs && columns !== 'auto' ? { gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` } : undefined}
    >
      {box && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute left-0 top-0',
            box.animated && 'transition-[transform,width,height] duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            isTabs ? 'bg-primary-600' : 'rounded-[10px] bg-surface shadow-sm',
          )}
          style={isTabs
            ? { width: box.width, height: 2, transform: `translate(${box.x}px, ${box.y + box.height - 2}px)` }
            : { width: box.width, height: box.height, transform: `translate(${box.x}px, ${box.y}px)` }}
        />
      )}
      {options.map((option, index) => {
        const selected = option.value === value;
        // Once the shared indicator is drawn, the button keeps only its text style.
        const drawn = selected && !box;
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
                  ? cn('relative min-h-10 whitespace-nowrap border-b-2 px-1 py-1 text-sm sm:min-h-0', drawn ? 'border-primary-600' : 'border-transparent', selected
                    ? 'text-primary-600'
                    : 'text-gray-500 hover:text-gray-900')
                  : variant === 'soft'
                  // Raised white pill: the selected tab is the only one with a surface.
                  ? cn('relative rounded-[10px] px-3', height, drawn && 'bg-surface shadow-sm', selected
                    ? 'font-semibold text-gray-950'
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
