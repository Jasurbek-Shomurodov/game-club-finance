'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ShimmerImage } from './ShimmerImage';
import { ShowcaseDialog } from './ShowcaseDialog';

/**
 * Photos of the club: the first one large, the rest in a grid. A photo opens
 * full screen, with arrows (and the arrow keys) to walk through the rest.
 */
export function PhotoGallery({ photos, clubName }: { photos: string[]; clubName: string }) {
  const t = useTranslations('publicShowcase');
  const [index, setIndex] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setIndex(null), []);
  const step = useCallback((by: number) => setIndex((current) => (current === null ? null : (current + by + photos.length) % photos.length)), [photos.length]);

  useEffect(() => {
    if (index === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [index, step]);

  if (photos.length === 0) return null;
  const arrow = 'absolute top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300';

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {photos.map((photo, position) => (
          <li key={photo} className={position === 0 ? 'col-span-2 row-span-2' : undefined}>
            <button
              type="button"
              onClick={(event) => {
                triggerRef.current = event.currentTarget;
                setIndex(position);
              }}
              aria-label={t('galleryOpen', { number: position + 1, total: photos.length })}
              className="group relative block aspect-[4/3] h-full w-full overflow-hidden rounded-2xl ring-1 ring-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              <span className="absolute inset-0 block transition-transform duration-700 group-hover:scale-105">
                <ShimmerImage src={photo} alt={t('galleryAlt', { club: clubName, number: position + 1 })} />
              </span>
            </button>
          </li>
        ))}
      </ul>

      <ShowcaseDialog open={index !== null} onClose={close} label={t('galleryTitle')} closeLabel={t('booking.close')} triggerRef={triggerRef} variant="viewer">
        {index !== null && (
          <div className="relative flex h-full items-center justify-center p-4 sm:p-12" onMouseDown={(event) => event.target === event.currentTarget && close()}>
            {/* Owner-supplied links may point at any host, so next/image's allow-list does not fit. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[index]} alt={t('galleryAlt', { club: clubName, number: index + 1 })} className="max-h-full max-w-full rounded-2xl object-contain" />
            {photos.length > 1 && (
              <>
                <button type="button" onClick={() => step(-1)} aria-label={t('galleryPrevious')} className={`${arrow} left-3`}>
                  <ChevronLeft size={24} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => step(1)} aria-label={t('galleryNext')} className={`${arrow} right-3`}>
                  <ChevronRight size={24} aria-hidden="true" />
                </button>
                <p className="sc-num absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm font-semibold text-white" aria-live="polite">
                  {index + 1} / {photos.length}
                </p>
              </>
            )}
          </div>
        )}
      </ShowcaseDialog>
    </>
  );
}
