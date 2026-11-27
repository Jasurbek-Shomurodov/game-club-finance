'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MIN_VIEWPORT_SPAN,
  clampViewport,
  createViewportGestures,
  showsAll,
  zoomViewport,
  type Viewport,
  type ViewportGestures,
} from '@/lib/chartViewport';

/** Zoom step of the zoom-in and zoom-out buttons. */
export const VIEWPORT_ZOOM_STEP = 1.6;

/**
 * Classes for the element that holds a navigable chart: a grab cursor, and no
 * browser panning, text selection or scrolling under the finger. Apply them
 * only while the chart is navigable (full screen), so the page still scrolls
 * over a chart in the normal card.
 */
export const navigableChartClassName = 'cursor-grab touch-none select-none data-[panning]:cursor-grabbing';

/** The plot's own box inside the axes, so a pointer's place maps to the right day; the element's box until it draws. */
function plotBox(element: HTMLElement): { left: number; width: number } {
  const box = (element.querySelector('.recharts-cartesian-grid') ?? element).getBoundingClientRect();
  return { left: box.left, width: box.width };
}

/**
 * Pan and zoom over time, as on a trading chart (gestures in
 * `createViewportGestures`). `extent` is every day the chart holds; with
 * `enabled` false the view always shows all of it and no gesture is listened
 * to. `initial` is where the view opens (a period's first day through the
 * last day); a new `initial.pick` opens it afresh, so choosing the same
 * period again zooms back to it. `onMove` hears every real move the person
 * makes (a drag, a zoom, showing all).
 *
 * Put `ref` on the element around the chart, check `consumeDrag()` first in
 * the chart's click handler (a drag never opens a day), and draw `view`.
 */
export function useChartViewport(
  extent: Viewport | null,
  enabled: boolean,
  initial?: { start: number; pick: number },
  onMove?: () => void,
) {
  const ref = useRef<HTMLDivElement>(null);
  // The view belongs to one extent and one choice of period: another of either opens at the chosen period again.
  const key = enabled && extent ? `${extent.start}:${extent.end}:${initial?.start}:${initial?.pick}` : '';
  const [state, setState] = useState<{ key: string; view: Viewport | null }>({ key: '', view: null });
  const stored = state.key === key ? state.view : null;
  const opening = extent && initial ? { start: initial.start, end: extent.end } : extent;
  const current = enabled && extent && opening ? clampViewport(stored ?? opening, extent) : extent;

  // The gesture listeners read the latest view and extent without being added again on every move.
  const viewRef = useRef<Viewport | null>(current);
  const extentRef = useRef(extent);
  const moveRef = useRef(onMove);
  useEffect(() => {
    viewRef.current = current;
    extentRef.current = extent;
    moveRef.current = onMove;
  });

  // Only a view that really changed counts as a move: zooming out at the whole extent leaves the period chosen.
  const setView = useCallback((view: Viewport) => {
    const now = viewRef.current;
    viewRef.current = view;
    setState({ key, view });
    if (!now || now.start !== view.start || now.end !== view.end) moveRef.current?.();
  }, [key]);

  // The gestures live with the listeners: created when the chart becomes navigable, dropped when it stops.
  const gesturesRef = useRef<ViewportGestures | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const gestures = createViewportGestures({
      plot: () => plotBox(element),
      view: () => viewRef.current,
      extent: () => extentRef.current,
      setView,
      setPanning: (panning) => {
        if (panning) element.dataset.panning = '';
        else delete element.dataset.panning;
      },
    });
    gesturesRef.current = gestures;
    const onWheel = (event: WheelEvent) => { if (gestures.wheel(event)) event.preventDefault(); };
    const onDown = (event: PointerEvent) => gestures.down(event);
    const onPointerMove = (event: PointerEvent) => gestures.move(event);
    const onUp = (event: PointerEvent) => gestures.up(event);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      delete element.dataset.panning;
      if (gesturesRef.current === gestures) gesturesRef.current = null;
    };
  }, [enabled, setView]);
  // Read in the chart's click handler: whether the press that ends in this click was a drag (never in the normal card).
  const consumeDrag = useCallback(() => gesturesRef.current?.consumeDrag() ?? false, []);

  const zoom = useCallback((factor: number, anchor = 0.5) => {
    const now = viewRef.current;
    const all = extentRef.current;
    if (now && all) setView(zoomViewport(now, all, anchor, factor));
  }, [setView]);
  const reset = useCallback(() => {
    if (extentRef.current) setView(extentRef.current);
  }, [setView]);

  const whole = !current || !extent || showsAll(current, extent);
  return {
    ref,
    /** What to draw: the zoomed stretch while navigable, else every day. */
    view: current,
    /** Whether every day is in view (zoom out and show all are then disabled). */
    whole,
    /** Whether the view can still narrow (it is longer than the shortest span). */
    canZoomIn: !!current && !!extent && current.end - current.start > Math.min(extent.end - extent.start, MIN_VIEWPORT_SPAN),
    zoom,
    reset,
    consumeDrag,
  };
}
