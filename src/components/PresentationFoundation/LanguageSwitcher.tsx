'use client';

import { isAppLocale, useAppLocale } from '@/components/i18n/AppLocaleContext';
import { cn } from '@/lib/utils';

const LANGUAGES = [
  { code: 'ru', label: 'RU', name: 'Русский' },
  { code: 'uz', label: 'UZ', name: "O'zbekcha" },
  { code: 'en', label: 'EN', name: 'English' },
];

interface LanguageSwitcherProps {
  /** `dark` is kept for callers on dark surfaces; both render the same soft track. */
  variant?: 'light' | 'dark';
  className?: string;
}

/** Compact three-way language toggle: grey track, raised white pill for the current language. */
export function LanguageSwitcher({ variant = 'light', className }: LanguageSwitcherProps) {
  const { locale, setLocale } = useAppLocale();
  const dark = variant === 'dark';

  return (
    <div
      role="group"
      aria-label="Language / Язык / Til"
      className={cn('inline-flex gap-0.5 rounded-lg p-0.5', dark ? 'bg-surface/10' : 'bg-gray-100', className)}
    >
      {LANGUAGES.map((lang) => {
        const selected = locale === lang.code;
        return (
          <button
            key={lang.code}
            type="button"
            lang={lang.code}
            aria-label={lang.name}
            aria-pressed={selected}
            onClick={() => {
              if (isAppLocale(lang.code) && lang.code !== locale) setLocale(lang.code);
            }}
            className={cn(
              'min-h-8 min-w-9 rounded-[7px] px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              selected
                ? dark ? 'bg-surface text-gray-950 shadow-sm' : 'bg-surface text-gray-950 shadow-sm'
                : dark ? 'text-white/70 hover:text-white' : 'text-gray-500 hover:text-gray-900',
            )}
          >
            {lang.label}
          </button>
        );
      })}
    </div>
  );
}
