'use client';

import { useEffect, useState } from 'react';

/**
 * Tracks an element's rendered height, e.g. a sticky table header so rows
 * below it can stick just underneath. Pass the returned ref callback as `ref`.
 */
export function useElementHeight<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!node) return;
    const measure = () => setHeight(node.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [setNode, height] as const;
}

/**
 * Top offset for a row that sticks under a sticky table header. Collapsed
 * table borders do not travel with sticky cells, so overlap the header by 1px
 * to leave no gap for scrolled rows to show through.
 */
export function stickyOffsetBelow(height: number): number {
  return Math.max(0, height - 1);
}
