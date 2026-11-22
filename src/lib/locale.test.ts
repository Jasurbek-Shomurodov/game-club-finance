import { describe, expect, it } from 'vitest';
import { PUBLIC_MESSAGE_NAMESPACES, localeFromAcceptLanguage, pickNamespaces, resolveRequestLocale } from './locale';

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
    // A public page's ?lang= address outranks the cookie; an invalid one is ignored.
    expect(resolveRequestLocale('ru', 'ru', 'uz')).toBe('uz');
    expect(resolveRequestLocale('en', 'ru', 'xx')).toBe('en');
    expect(resolveRequestLocale(undefined, 'ru')).toBe('ru');
  });
});

describe('pickNamespaces', () => {
  it('keeps only the named namespaces that exist', () => {
    expect(pickNamespaces({ common: { a: 1 }, dashboard: { b: 2 }, publicShowcase: { c: 3 } }, PUBLIC_MESSAGE_NAMESPACES))
      .toEqual({ common: { a: 1 }, publicShowcase: { c: 3 } });
  });
});
