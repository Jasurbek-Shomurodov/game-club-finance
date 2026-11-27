'use client';

import { Maximize, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IconButton } from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';
import { VIEWPORT_ZOOM_STEP } from './useChartViewport';

/**
 * The card's full-screen button: the card fills the window and comes back,
 * keeping its period, hidden lines and open day.
 */
export function FullscreenToggle({ open, onToggle, className }: { open: boolean; onToggle: () => void; className?: string }) {
  const t = useTranslations('charts');
  return (
    <IconButton
      className={className}
      label={open ? t('exitFullScreen') : t('openFullScreen')}
      aria-pressed={open}
      icon={open ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
      onClick={onToggle}
    />
  );
}

/**
 * The full-screen chart's zoom buttons beside a line on how to drag and zoom
 * (the line is left out on phones, where the buttons speak for themselves).
 */
export function ChartViewportTools({ whole, canZoomIn, onZoom, onReset, className }: {
  /** Every day is in view: zoom out and show all have nothing to do. */
  whole: boolean;
  canZoomIn: boolean;
  onZoom: (factor: number) => void;
  onReset: () => void;
  className?: string;
}) {
  const t = useTranslations('charts');
  return (
    <div role="group" aria-label={t('viewportLabel')} className={cn('flex cursor-default items-center justify-end gap-1.5', className)}>
      <span className="mr-1.5 text-xs text-gray-500 max-sm:hidden">{t('viewportHint')}</span>
      <IconButton label={t('zoomOut')} icon={<ZoomOut size={16} aria-hidden="true" />} disabled={whole} onClick={() => onZoom(VIEWPORT_ZOOM_STEP)} />
      <IconButton label={t('zoomIn')} icon={<ZoomIn size={16} aria-hidden="true" />} disabled={!canZoomIn} onClick={() => onZoom(1 / VIEWPORT_ZOOM_STEP)} />
      <IconButton label={t('showAll')} icon={<Maximize size={16} aria-hidden="true" />} disabled={whole} onClick={onReset} />
    </div>
  );
}
