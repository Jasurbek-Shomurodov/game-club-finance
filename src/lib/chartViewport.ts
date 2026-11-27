/**
 * The stretch of time a pannable chart shows, in milliseconds: zoomed around a
 * point, moved sideways, and never past the days the chart holds. Pure, so the
 * gestures in `useChartViewport` stay a thin layer over tested arithmetic.
 */
export interface Viewport {
  start: number;
  end: number;
}

const DAY_MS = 86_400_000;

/** The shortest stretch a chart zooms in to: two days, so at least one line segment stays in view. */
export const MIN_VIEWPORT_SPAN = 2 * DAY_MS;

/** How far a mouse press must travel, in pixels, before it counts as a drag rather than a click on a day. */
export const DRAG_THRESHOLD_PX = 4;
/** The same for a finger, which wobbles more on a tap. */
export const TOUCH_DRAG_THRESHOLD_PX = 10;

/** Whether two views cover the same stretch. */
export function sameViewport(a: Viewport, b: Viewport): boolean {
  return a.start === b.start && a.end === b.end;
}

/** A stored ISO day (`2026-11-28`) as the timestamp a time axis draws it at (midnight UTC, so no time zone moves it). */
export function dayTimestamp(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/** The ISO day a time-axis timestamp stands for; the inverse of `dayTimestamp`. */
export function timestampDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** The days a chart can move through: none for fewer than two points. */
export function viewportExtent(points: ReadonlyArray<{ timestamp: number }>): Viewport | null {
  return points.length > 1 ? { start: points[0].timestamp, end: points[points.length - 1].timestamp } : null;
}

/** Keeps a view inside `extent`, no shorter than `minSpan` (or the whole extent, when that is shorter). */
export function clampViewport(view: Viewport, extent: Viewport, minSpan = MIN_VIEWPORT_SPAN): Viewport {
  const full = extent.end - extent.start;
  const span = Math.min(full, Math.max(minSpan, view.end - view.start));
  const start = Math.min(extent.end - span, Math.max(extent.start, view.start));
  return { start, end: start + span };
}

/**
 * Zooms by `factor` (below 1 zooms in) around `anchor`, a fraction of the
 * width from the left edge, so the day under the pointer stays under it.
 */
export function zoomViewport(view: Viewport, extent: Viewport, anchor: number, factor: number, minSpan = MIN_VIEWPORT_SPAN): Viewport {
  const at = Math.min(1, Math.max(0, anchor));
  const span = view.end - view.start;
  const next = span * factor;
  const pivot = view.start + span * at;
  return clampViewport({ start: pivot - next * at, end: pivot - next * at + next }, extent, minSpan);
}

/** Moves the view by `shift` milliseconds (negative goes back in time), stopping at either end. */
export function panViewport(view: Viewport, extent: Viewport, shift: number): Viewport {
  const span = view.end - view.start;
  const start = Math.min(extent.end - span, Math.max(extent.start, view.start + shift));
  return { start, end: start + span };
}

/** Whether a view shows every day the chart holds, so "show all" and "zoom out" have nothing to do. */
export function showsAll(view: Viewport, extent: Viewport): boolean {
  return view.start <= extent.start && view.end >= extent.end;
}

/** The points a view draws: those inside it plus one neighbour on each side, so lines run out to both edges. */
export function pointsInView<T extends { timestamp: number }>(points: readonly T[], view: Viewport): T[] {
  const first = points.findIndex((point) => point.timestamp >= view.start);
  if (first === -1) return points.slice(-1);
  // A gap with no point inside the view: the two around it carry the line across.
  if (points[first].timestamp > view.end) return points.slice(Math.max(0, first - 1), first + 1);
  let last = first;
  while (last + 1 < points.length && points[last + 1].timestamp <= view.end) last++;
  return points.slice(Math.max(0, first - 1), Math.min(points.length, last + 2));
}

/**
 * The points strictly inside a view, for what draws one slot per day (bars)
 * and for figures about the days shown; all of them without a view.
 */
export function pointsWithin<T extends { timestamp: number }>(points: readonly T[], view: Viewport | null): T[] {
  return view ? points.filter((point) => point.timestamp >= view.start && point.timestamp <= view.end) : [...points];
}

/**
 * The day a tap or a click on point `index` of the drawn points opens. A
 * zoomed-in line chart also draws the neighbour just outside each edge
 * (`pointsInView`), so the line runs out to the edge; that point is off the
 * plot, and a press resolving to it opens nothing.
 */
export function pickedDay<T extends { iso: string; timestamp: number }>(drawn: readonly T[], index: unknown, view: Viewport | null): T | undefined {
  if (index === undefined || index === null || index === '') return undefined;
  const point = drawn[Number(index)];
  if (!point) return undefined;
  if (view && (point.timestamp < view.start || point.timestamp > view.end)) return undefined;
  return point;
}

/** What the gestures read from and write to the chart: its plot box, its current view and the days it holds. */
export interface ViewportGestureHost {
  /** The plot's own box inside the axes, in client pixels. */
  plot: () => { left: number; width: number };
  view: () => Viewport | null;
  extent: () => Viewport | null;
  setView: (view: Viewport) => void;
  /** A drag started or ended, for the grabbing cursor. */
  setPanning: (panning: boolean) => void;
}

export interface WheelInput { deltaX: number; deltaY: number; ctrlKey: boolean; clientX: number }
export interface PointerInput { pointerId: number; pointerType: string; button?: number; clientX: number }

/**
 * Pan and zoom over time, as on a trading chart: a drag (or a swipe) moves
 * through the days, the wheel, a trackpad pinch (a wheel with Ctrl) or a
 * two-finger pinch zooms around the pointer, and a sideways scroll moves.
 * There is no double-click gesture: the first click of one would already open
 * a day, so "show all" is a button. `consumeDrag` tells a click handler that
 * the press it ends was a drag, so a drag never opens a day.
 *
 * Framework-free: `useChartViewport` feeds it the element's events.
 */
export function createViewportGestures(host: ViewportGestureHost) {
  let press: { x: number; view: Viewport; moved: boolean; threshold: number } | null = null;
  let pinch: { distance: number; mid: number; view: Viewport } | null = null;
  let dragged = false;
  const touches = new Map<number, number>();

  const fraction = (clientX: number) => {
    const box = host.plot();
    return box.width ? (clientX - box.left) / box.width : 0.5;
  };
  // Dragging right brings earlier days into view, so the shift runs against the pointer.
  const shiftFor = (pixels: number, view: Viewport) => (-pixels / Math.max(1, host.plot().width)) * (view.end - view.start);

  return {
    /**
     * Returns true when the wheel moved the chart, so the caller stops the page
     * from scrolling; false when it could not move (already at an end, fully
     * zoomed in or out), so the page scrolls on.
     */
    wheel(event: WheelInput): boolean {
      const view = host.view();
      const extent = host.extent();
      if (!view || !extent) return false;
      const next = Math.abs(event.deltaX) > Math.abs(event.deltaY) && !event.ctrlKey
        ? panViewport(view, extent, -shiftFor(event.deltaX, view))
        // A trackpad pinch arrives as a wheel with Ctrl held and small steps, so it zooms faster per step.
        : zoomViewport(view, extent, fraction(event.clientX), Math.exp(event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)));
      if (sameViewport(next, view)) return false;
      host.setView(next);
      return true;
    },
    down(event: PointerInput) {
      const view = host.view();
      if ((event.button ?? 0) !== 0 || !view) return;
      dragged = false;
      if (event.pointerType === 'touch') {
        touches.set(event.pointerId, event.clientX);
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          pinch = { distance: Math.max(1, Math.abs(a - b)), mid: fraction((a + b) / 2), view };
          press = null;
          return;
        }
      }
      press = { x: event.clientX, view, moved: false, threshold: event.pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX };
    },
    move(event: PointerInput) {
      const extent = host.extent();
      if (!extent) return;
      if (touches.has(event.pointerId)) touches.set(event.pointerId, event.clientX);
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        host.setView(zoomViewport(pinch.view, extent, pinch.mid, pinch.distance / Math.max(1, Math.abs(a - b))));
        dragged = true;
        return;
      }
      if (!press) return;
      const dx = event.clientX - press.x;
      if (!press.moved && Math.abs(dx) < press.threshold) return;
      if (!press.moved) host.setPanning(true);
      press.moved = true;
      dragged = true;
      host.setView(panViewport(press.view, extent, shiftFor(dx, press.view)));
    },
    up(event: Pick<PointerInput, 'pointerId'>) {
      touches.delete(event.pointerId);
      if (touches.size < 2) pinch = null;
      if (press?.moved) host.setPanning(false);
      press = null;
    },
    /** Whether the press that ends in this click was a drag or a pinch; reading it clears it. */
    consumeDrag(): boolean {
      const was = dragged;
      dragged = false;
      return was;
    },
  };
}

export type ViewportGestures = ReturnType<typeof createViewportGestures>;
