'use client';

import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrencyInput } from '@/lib/formatters';

/** Shared text-control styling; exported so bespoke controls can match it. */
export const controlClassName =
  'w-full rounded-xl border border-gray-200 bg-surface px-3.5 text-base text-gray-900 sm:text-sm outline-none transition ' +
  'placeholder:text-gray-400 hover:border-gray-300 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/15 ' +
  'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 aria-[invalid=true]:border-danger-500 aria-[invalid=true]:focus:ring-danger-500/15';

export const labelClassName = 'mb-1.5 block text-[13px] font-medium text-gray-700';

export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  /** Trailing element on the label row (e.g. a lock icon). */
  labelAddon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Label + control + hint/error wrapper. Use with Input/Select/Textarea/DatePicker. */
export function Field({ label, htmlFor, required, hint, error, labelAddon, children, className }: FieldProps) {
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <label data-field-label htmlFor={htmlFor} className={cn(labelClassName, 'flex items-center gap-1.5')}>
          <span>{label}</span>
          {required && <span className="text-danger-500" aria-hidden="true">*</span>}
          {labelAddon}
        </label>
      )}
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs font-medium text-danger-600">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs leading-5 text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}

type ControlSize = 'sm' | 'md' | 'lg';
const controlHeight: Record<ControlSize, string> = { sm: 'h-10', md: 'h-11', lg: 'h-14 text-xl font-bold' };

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  controlSize?: ControlSize;
  invalid?: boolean;
  leadingIcon?: ReactNode;
  /** Text or element pinned to the right inside the control (currency, unit). */
  trailingAddon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { controlSize = 'md', invalid, leadingIcon, trailingAddon, className, ...rest },
  ref,
) {
  const control = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(controlClassName, controlHeight[controlSize], leadingIcon && 'pl-10', trailingAddon && 'pr-16', className)}
      {...rest}
    />
  );

  if (!leadingIcon && !trailingAddon) return control;

  return (
    <div className="relative min-w-0">
      {leadingIcon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true">
          {leadingIcon}
        </span>
      )}
      {control}
      {trailingAddon && (
        <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs font-medium text-gray-500">
          {trailingAddon}
        </span>
      )}
    </div>
  );
});

export interface CurrencyInputProps extends Omit<InputProps, 'value' | 'onChange' | 'type' | 'inputMode'> {
  value: string;
  /** Receives the already thousands-formatted string. Parse with `parseCurrencyInput` when saving. */
  onValueChange: (formatted: string) => void;
}

/** Index in `formatted` just after the `digitCount`-th digit. */
function caretAfterDigits(formatted: string, digitCount: number) {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (/\d/.test(formatted[index])) {
      seen += 1;
      if (seen === digitCount) return index + 1;
    }
  }
  return formatted.length;
}

/**
 * Whole-UZS input that keeps thousands separators while typing. The caret
 * stays next to the digit being edited even when separators shift.
 */
export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(function CurrencyInput(
  { value, onValueChange, className, placeholder = '0', ...rest },
  forwardedRef,
) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const pendingCaretDigits = useRef<number | null>(null);

  const setRefs = useCallback((element: HTMLInputElement | null) => {
    innerRef.current = element;
    if (typeof forwardedRef === 'function') forwardedRef(element);
    else if (forwardedRef) forwardedRef.current = element;
  }, [forwardedRef]);

  useLayoutEffect(() => {
    const input = innerRef.current;
    const digits = pendingCaretDigits.current;
    if (!input || digits === null || document.activeElement !== input) return;
    pendingCaretDigits.current = null;
    const position = caretAfterDigits(value, digits);
    input.setSelectionRange(position, position);
  }, [value]);

  return (
    <Input
      ref={setRefs}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder={placeholder}
      value={value}
      onChange={(event) => {
        const raw = event.target.value;
        const caret = event.target.selectionStart ?? raw.length;
        const formatted = formatCurrencyInput(raw);
        // Digits before the caret, capped by what survived formatting (decimals, length cap).
        const digitsBefore = raw.slice(0, caret).replace(/\D/g, '').length;
        pendingCaretDigits.current = Math.min(digitsBefore, formatted.replace(/\D/g, '').length);
        onValueChange(formatted);
      }}
      className={cn('tabular-nums', className)}
      {...rest}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** Shows `current/max` under the control when `maxLength` is set. */
  showCount?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, showCount = false, className, maxLength, value, ...rest },
  ref,
) {
  return (
    <>
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        maxLength={maxLength}
        value={value}
        className={cn(controlClassName, 'min-h-24 resize-y py-2.5', className)}
        {...rest}
      />
      {showCount && maxLength ? (
        <p className="mt-1 text-right text-xs text-gray-400">{String(value ?? '').length}/{maxLength}</p>
      ) : null}
    </>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  controlSize?: ControlSize;
  invalid?: boolean;
  leadingIcon?: ReactNode;
}

/** Native select with a consistent chevron. Native is deliberate for mobile. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { controlSize = 'md', invalid, leadingIcon, className, children, ...rest },
  ref,
) {
  return (
    <div className="relative min-w-0">
      {leadingIcon && (
        <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-gray-400" aria-hidden="true">
          {leadingIcon}
        </span>
      )}
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(controlClassName, controlHeight[controlSize], 'appearance-none pr-9', leadingIcon && 'pl-10', className)}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
    </div>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
  /** `card`: bordered, full-width tile for multi-select option lists (payment methods, page access). */
  variant?: 'plain' | 'card';
}

export function Checkbox({ label, description, variant = 'plain', className, id, ...rest }: CheckboxProps) {
  const card = variant === 'card';
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 text-sm text-gray-700 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-70',
        card &&
          'min-h-11 rounded-xl border border-gray-200 bg-surface px-3.5 py-3 transition hover:border-gray-300 has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50/60 has-[:checked]:ring-1 has-[:checked]:ring-primary-500 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-500',
        className,
      )}
    >
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-primary-600" {...rest} />
      <span className="min-w-0">
        <span className="block font-medium text-gray-800">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-5 text-gray-500">{description}</span>}
      </span>
    </label>
  );
}
