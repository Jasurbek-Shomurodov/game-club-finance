'use client';

import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { controlClassName } from './Field';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name; defaults to the placeholder. */
  label?: string;
  clearLabel?: string;
  disabled?: boolean;
  className?: string;
  controlSize?: 'sm' | 'md';
}

/** Search box with a leading icon and a clear button once there is text. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  clearLabel,
  disabled = false,
  className,
  controlSize = 'md',
}: SearchInputProps) {
  const tc = useTranslations('common');
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        type="search"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(controlClassName, controlSize === 'sm' ? 'h-10' : 'h-11', 'pl-10 pr-9 rounded-xl [&::-webkit-search-cancel-button]:hidden')}
      />
      {value && !disabled && (
        <button
          type="button"
          aria-label={clearLabel ?? tc('clearSearch')}
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 flex h-8 w-8 max-sm:before:absolute max-sm:before:-inset-1 max-sm:before:content-[''] -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
