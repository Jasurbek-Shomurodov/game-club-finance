'use client';

import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 1400;

/** Counts from zero to `value` once it scrolls into view; renders the final number without JavaScript. */
export function CountUp({ value, format }: { value: number; format?: 'plain' | 'grouped' }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    setShown(0);
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / DURATION_MS);
        const eased = 1 - (1 - progress) ** 3;
        setShown(Math.round(value * eased));
        if (progress < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);

  const text = format === 'grouped' ? shown.toLocaleString('ru-RU').replace(/ /g, ' ') : String(shown);
  return <span ref={ref} className="tabular-nums">{text}</span>;
}
