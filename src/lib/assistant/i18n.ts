import en from '@/messages/en.json';
import ru from '@/messages/ru.json';
import uz from '@/messages/uz.json';
import type { Translate } from './excel';
import { ASSISTANT_LOCALES, type AssistantLocale } from './locales';

const MESSAGES: Record<AssistantLocale, unknown> = { en, ru, uz };

export const LANGUAGE_NAMES: Record<AssistantLocale, string> = {
  en: 'English',
  ru: 'Russian',
  uz: 'Uzbek (Latin script)',
};

export function isAssistantLocale(value: unknown): value is AssistantLocale {
  return typeof value === 'string' && (ASSISTANT_LOCALES as readonly string[]).includes(value);
}

/** Server-side lookup of the same message files the UI uses. */
export function createTranslator(locale: AssistantLocale): Translate {
  return (path) => {
    let node: unknown = MESSAGES[locale];
    for (const part of path.split('.')) {
      if (!node || typeof node !== 'object') return null;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string' ? node : null;
  };
}
