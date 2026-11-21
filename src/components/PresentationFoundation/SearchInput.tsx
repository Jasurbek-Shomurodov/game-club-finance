'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { controlClassName } from './Field';

/** What the box passes straight to its `<input>`, so it can be a combobox over a list of results. */
type SearchInputPassThrough = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  | 'id'
  | 'role'
  | 'aria-activedescendant'
  | 'aria-controls'
  | 'aria-expanded'
  | 'aria-autocomplete'
  | 'onKeyDown'
  | 'autoComplete'
  | 'autoCorrect'
  | 'spellCheck'
  | 'enterKeyHint'
>;

export interface SearchInputProps extends SearchInputPassThrough {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name; defaults to the placeholder. */
  label?: string;
  clearLabel?: string;
  disabled?: boolean;
  className?: string;
  controlSize?: 'sm' | 'md';
  /**
   * `field` (default) is the bordered box above a list. `bare` is the
   * borderless 56 px search line that heads a dialog (the command palette):
   * the dialog is its frame, so it draws no border or ring of its own.
   */
  variant?: 'field' | 'bare';
  /** The clear button shown once there is text. On by default. */
  clearable?: boolean;
  /** Shown after the input (a keyboard hint). */
  trailing?: ReactNode;
}

const clearButtonClassName =
  "flex h-8 w-8 max-sm:before:absolute max-sm:before:-inset-1 max-sm:before:content-[''] items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

/**
 * Search box with a leading icon and a clear button once there is text. Pass
 * `role="combobox"` with `aria-controls`, `aria-expanded`,
 * `aria-activedescendant` and `onKeyDown` to drive a list of results from it;
 * the ref reaches the `<input>`.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onChange,
    placeholder,
    label,
    clearLabel,
    disabled = false,
    className,
    controlSize = 'md',
    variant = 'field',
    clearable = true,
    trailing,
    ...inputProps
  },
  ref,
) {
  const tc = useTranslations('common');
  const bare = variant === 'bare';
  const input = (
    <input
      ref={ref}
      type="search"
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={label ?? placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={bare
        ? 'h-14 min-w-0 flex-1 bg-transparent text-base text-gray-950 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed disabled:text-gray-400 [&::-webkit-search-cancel-button]:hidden'
        : cn(controlClassName, controlSize === 'sm' ? 'h-10' : 'h-11', 'pl-10 rounded-xl [&::-webkit-search-cancel-button]:hidden', trailing ? 'pr-16' : 'pr-9')}
      {...inputProps}
    />
  );
  const clear = clearable && value && !disabled ? (
    <button
      type="button"
      aria-label={clearLabel ?? tc('clearSearch')}
      onClick={() => onChange('')}
      className={cn(clearButtonClassName, bare ? 'relative shrink-0' : 'absolute right-1.5 top-1/2 -translate-y-1/2')}
    >
      <X size={15} />
    </button>
  ) : null;

  if (bare) {
    return (
      <div className={cn('flex min-w-0 items-center gap-3', className)}>
        <Search size={18} aria-hidden="true" className="shrink-0 text-gray-400" />
        {input}
        {clear}
        {trailing}
      </div>
    );
  }

  return (
    <div className={cn('relative min-w-0', className)}>
      <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      {input}
      {/* Text keeps the corner for its clear button; an empty box shows the hint there. */}
      {clear ?? (trailing ? <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center">{trailing}</span> : null)}
    </div>
  );
});
