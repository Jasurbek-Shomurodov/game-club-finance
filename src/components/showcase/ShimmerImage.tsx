'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface ShimmerImageProps {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  /** Load immediately instead of lazily (the hero image). */
  priority?: boolean;
}

/** An image that shows a moving shimmer until it has loaded, then fades in. */
export function ShimmerImage({ src, alt, className, imgClassName, priority = false }: ShimmerImageProps) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // A cached image can finish loading before hydration attaches onLoad.
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth > 0) setLoaded(true);
  }, [src]);

  return (
    <span className={cn('absolute inset-0 block overflow-hidden', !loaded && 'sc-shimmer', className)}>
      {!failed && (
        // Owner-supplied links may point at any host, so next/image's allow-list does not fit.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={ref}
          src={src}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          data-loaded={loaded}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn('sc-img h-full w-full object-cover', imgClassName)}
        />
      )}
    </span>
  );
}
