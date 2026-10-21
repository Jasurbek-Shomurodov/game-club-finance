'use client';

import type { KeyboardEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from './IconButton';

export interface StepperProps {
  value: string;
  onChange: (value: string) => void;
  onStep: (delta: 1 | -1) => void;
  label: string;
  /** Lets a surrounding `<Field htmlFor>` label the input. */
  id?: string;
  decreaseLabel: string;
  increaseLabel: string;
  min?: number;
  max?: number | null;
  disabled?: boolean;
  invalid?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

function preventNonIntegerKeys(event: KeyboardEvent<HTMLInputElement>) {
  if (['.', ',', 'e', 'E', '+', '-'].includes(event.key)) event.preventDefault();
}

/** Whole-number quantity control: minus / text input / plus. */
export function Stepper({
  value,
  onChange,
  onStep,
  label,
  id,
  decreaseLabel,
  increaseLabel,
  min = 0,
  max = null,
  disabled = false,
  invalid = false,
  size = 'md',
  className,
}: StepperProps) {
  const numeric = Number(value || 0) || 0;
  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      <IconButton
        size={size}
        label={decreaseLabel}
        icon={<Minus size={size === 'sm' ? 15 : 18} strokeWidth={2.5} />}
        disabled={disabled || numeric <= min}
        onClick={() => onStep(-1)}
      />
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={value}
        disabled={disabled}
        onKeyDown={preventNonIntegerKeys}
        onWheel={(event) => event.currentTarget.blur()}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
        className={cn(
          'rounded-xl border bg-surface text-center font-bold tabular-nums text-gray-900 outline-none transition focus:ring-2 disabled:bg-gray-50 disabled:text-gray-400',
          size === 'sm' ? 'h-8 w-14 text-base sm:text-sm' : 'h-10 w-20 text-base sm:text-sm',
          invalid
            ? 'border-danger-400 text-danger-600 focus:ring-danger-500/15'
            : 'border-gray-200 focus:border-primary-500 focus:ring-primary-500/15',
        )}
      />
      <IconButton
        size={size}
        label={increaseLabel}
        icon={<Plus size={size === 'sm' ? 15 : 18} strokeWidth={2.5} />}
        disabled={disabled || (max !== null && numeric >= max)}
        onClick={() => onStep(1)}
      />
    </div>
  );
}
