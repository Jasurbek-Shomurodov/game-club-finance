'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy } from 'lucide-react';
import { Button, Input, SegmentedControl, Textarea, labelClassName } from '@/components/PresentationFoundation';
import { SHOWCASE_LANGUAGES, type LocalizedText, type ShowcaseLanguage } from '@/lib/showcase';
import { cn } from '@/lib/utils';

interface LocalizedTextFieldProps {
  id: string;
  label: string;
  value: LocalizedText;
  onChange: (value: LocalizedText) => void;
  multiline?: boolean;
  /** Rows of the multiline control. */
  rows?: number;
  maxLength: number;
  placeholder?: string;
  hint?: string;
}

/**
 * One text in every app language: a RU / UZ / EN switch (a radio group)
 * above a single control. A language that still has no text shows a warning dot; visitors
 * then see the first filled language instead.
 */
export function LocalizedTextField({ id, label, value, onChange, multiline = false, rows = 3, maxLength, placeholder, hint }: LocalizedTextFieldProps) {
  const t = useTranslations('showcase');
  const [language, setLanguage] = useState<ShowcaseLanguage>('ru');
  const controlId = `${id}-${language}`;
  const missing = SHOWCASE_LANGUAGES.filter((code) => !value[code].trim());
  const anyFilled = missing.length < SHOWCASE_LANGUAGES.length;
  // A name like "VIP" or "PlayStation 5" reads the same everywhere: one tap fills the empty languages with the text on screen.
  const canCopy = Boolean(value[language].trim()) && missing.length > 0;
  const copyToMissing = () => onChange({ ...value, ...Object.fromEntries(missing.map((code) => [code, value[language].trim()])) });

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label htmlFor={controlId} className={cn(labelClassName, 'mb-0')}>{label}</label>
        {/* Negative margin keeps this row as tall as a plain field label, so inputs beside it line up. */}
        <SegmentedControl<ShowcaseLanguage>
          variant="soft"
          size="sm"
          label={t('languageSwitch')}
          className="w-44 shrink-0 sm:-my-3"
          value={language}
          onChange={setLanguage}
          options={SHOWCASE_LANGUAGES.map((code) => ({
            value: code,
            label: code.toUpperCase(),
            // A language that still has no text carries a warning dot.
            icon: anyFilled && !value[code].trim()
              ? <span role="img" aria-label={t('languageNotFilled')} className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-500" />
              : undefined,
          }))}
        />
      </div>
      {multiline ? (
        <Textarea
          id={controlId}
          lang={language}
          rows={rows}
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
      <div className="mt-1.5 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 text-xs leading-5 text-gray-500">
          {anyFilled && missing.length > 0
            ? t('languagesMissingHint', { languages: missing.map((code) => code.toUpperCase()).join(', ') })
            : hint}
        </p>
        {canCopy && (
          <Button type="button" variant="ghost" size="sm" className="-my-1 shrink-0" icon={<Copy size={14} aria-hidden="true" />} onClick={copyToMissing}>
            {t('copyToLanguages', { languages: missing.map((code) => code.toUpperCase()).join(', ') })}
          </Button>
        )}
      </div>
    </div>
  );
}
