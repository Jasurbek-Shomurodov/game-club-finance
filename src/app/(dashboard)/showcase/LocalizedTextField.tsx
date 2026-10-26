'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input, Textarea, labelClassName } from '@/components/PresentationFoundation';
import { SHOWCASE_LANGUAGES, type LocalizedText, type ShowcaseLanguage } from '@/lib/showcase';
import { cn } from '@/lib/utils';

interface LocalizedTextFieldProps {
  id: string;
  label: string;
  value: LocalizedText;
  onChange: (value: LocalizedText) => void;
  multiline?: boolean;
  maxLength: number;
  placeholder?: string;
  hint?: string;
}

/**
 * One text in every app language: a RU / UZ / EN switch above a single
 * control. A language that still has no text shows a warning dot; visitors
 * then see the first filled language instead.
 */
export function LocalizedTextField({ id, label, value, onChange, multiline = false, maxLength, placeholder, hint }: LocalizedTextFieldProps) {
  const t = useTranslations('showcase');
  const [language, setLanguage] = useState<ShowcaseLanguage>('ru');
  const controlId = `${id}-${language}`;
  const missing = SHOWCASE_LANGUAGES.filter((code) => !value[code].trim());
  const anyFilled = missing.length < SHOWCASE_LANGUAGES.length;

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label htmlFor={controlId} className={cn(labelClassName, 'mb-0')}>{label}</label>
        <div role="group" aria-label={t('languageSwitch')} className="inline-flex gap-0.5 rounded-lg bg-gray-100 p-0.5">
          {SHOWCASE_LANGUAGES.map((code) => {
            const selected = code === language;
            const empty = anyFilled && !value[code].trim();
            return (
              <button
                key={code}
                type="button"
                aria-pressed={selected}
                aria-label={empty ? t('languageMissing', { language: code.toUpperCase() }) : code.toUpperCase()}
                onClick={() => setLanguage(code)}
                className={cn(
                  'relative min-h-7 min-w-9 rounded-md px-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                  selected ? 'bg-surface text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-900',
                )}
              >
                {code.toUpperCase()}
                {empty && <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warning-500" />}
              </button>
            );
          })}
        </div>
      </div>
      {multiline ? (
        <Textarea
          id={controlId}
          lang={language}
          rows={3}
          maxLength={maxLength}
          placeholder={placeholder}
          value={value[language]}
          onChange={(event) => onChange({ ...value, [language]: event.target.value })}
        />
      ) : (
        <Input
          id={controlId}
          lang={language}
          maxLength={maxLength}
          placeholder={placeholder}
          value={value[language]}
          onChange={(event) => onChange({ ...value, [language]: event.target.value })}
        />
      )}
      <p className="mt-1.5 text-xs leading-5 text-gray-500">
        {anyFilled && missing.length > 0
          ? t('languagesMissingHint', { languages: missing.map((code) => code.toUpperCase()).join(', ') })
          : hint}
      </p>
    </div>
  );
}
