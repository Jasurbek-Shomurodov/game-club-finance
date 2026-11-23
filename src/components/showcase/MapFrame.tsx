'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

/** How long the map's own script needs after the frame loads to draw over its plain-text fallback. */
const DRAW_GRACE_MS = 500;

/**
 * An embedded map behind a shimmer until it has drawn. The map service's frame
 * shows bare links (its name for the place, its category) before its script
 * runs; on a slow connection that text sat in the card for seconds.
 */
export function MapFrame({ src, title }: { src: string; title: string }) {
  // The address is set after hydration, so the load event is never missed.
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setReady(false);
    setFrameSrc(src);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [src]);

  return (
    <div className={cn('absolute inset-0 overflow-hidden', !ready && 'sc-shimmer')} aria-busy={!ready}>
      {!ready && (
        <span className="absolute inset-0 flex items-center justify-center text-white/30" aria-hidden="true">
          <MapPin size={32} />
        </span>
      )}
      {frameSrc && (
        <iframe
          src={frameSrc}
          title={title}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={() => {
            timer.current = setTimeout(() => setReady(true), DRAW_GRACE_MS);
          }}
          className={cn('absolute inset-0 h-full w-full border-0 transition-opacity duration-500', ready ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </div>
  );
}
