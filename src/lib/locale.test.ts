import { describe, expect, it } from 'vitest';
import { localeFromAcceptLanguage, resolveRequestLocale } from './locale';

describe('request locale', () => {
  it('follows the device language, best match first', () => {
    expect(localeFromAcceptLanguage('uz-Latn-UZ,uz;q=0.9,ru;q=0.8')).toBe('uz');
    expect(localeFromAcceptLanguage('ru-RU,ru;q=0.9,en-US;q=0.8')).toBe('ru');
    expect(localeFromAcceptLanguage('en-GB,en;q=0.9')).toBe('en');
    expect(localeFromAcceptLanguage('de-DE,de;q=0.9,uz;q=0.5')).toBe('uz');
    expect(localeFromAcceptLanguage('en;q=0.4,ru;q=0.8')).toBe('ru');
  });

  it('falls back to English for other languages and Russian without a header', () => {
    expect(localeFromAcceptLanguage('de-DE,fr;q=0.8')).toBe('en');
    expect(localeFromAcceptLanguage('ru;q=0, de')).toBe('en');
    expect(localeFromAcceptLanguage('')).toBe('ru');
    expect(localeFromAcceptLanguage(null)).toBe('ru');
  });

  it('lets a saved choice win over the device language', () => {
    expect(resolveRequestLocale('en', 'ru-RU')).toBe('en');
    expect(resolveRequestLocale('xx', 'uz')).toBe('uz');
    expect(resolveRequestLocale(undefined, 'ru')).toBe('ru');
  });
});
