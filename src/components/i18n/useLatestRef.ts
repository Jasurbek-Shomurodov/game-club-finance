'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * Keeps a ref pointing at the latest value without changing identity.
 *
 * Use it for translators (`useTranslations`) read inside data-loading
 * callbacks and effects: a language switch changes `t`, and listing `t` as a
 * dependency would refetch the page and discard unsaved edits.
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
